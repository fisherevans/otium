package youtube

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/fisherevans/otium/internal/server/store"
)

// ImportWorker drains the durable source_import queue (#122): for each queued
// YouTube source it imports one page of the backlog per tick, bounded to the
// source's resolved Archive-After window (older videos are never eligible), and
// resumes across restarts from the persisted page_token. Same policy shape as the
// enrich worker - exponential backoff on transient errors (quota / 5xx / network),
// a global cooldown on quota, give up after maxImportAttempts.
type ImportWorker struct {
	db       *store.DB
	client   *Client
	log      *slog.Logger
	cooldown time.Time
}

const (
	importTick     = 15 * time.Second
	importBatch    = 4 // sources advanced per tick (one page each)
	importPace     = 400 * time.Millisecond
	importCooldown = 15 * time.Minute // quota backoff (quota resets daily; this just paces)
)

var (
	maxImportAttempts = 6
	importBackoffBase = time.Minute
	importNow         = time.Now
)

func NewImportWorker(db *store.DB, client *Client, log *slog.Logger) *ImportWorker {
	return &ImportWorker{db: db, client: client, log: log}
}

func (w *ImportWorker) Run(ctx context.Context) {
	w.log.Info("youtube import worker starting")
	t := time.NewTicker(importTick)
	defer t.Stop()
	for {
		w.tick(ctx)
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

func (w *ImportWorker) tick(ctx context.Context) {
	if importNow().Before(w.cooldown) {
		return
	}
	jobs, err := w.db.DueImports(ctx, importNow(), importBatch)
	if err != nil {
		w.log.Warn("import due query", "err", err)
		return
	}
	for _, j := range jobs {
		if ctx.Err() != nil {
			return
		}
		if w.step(ctx, j) {
			return // hit a global cooldown; stop this tick
		}
		sleep(ctx, importPace)
	}
}

// step advances one source by one page. Returns true if a global cooldown was set.
func (w *ImportWorker) step(ctx context.Context, j store.ImportJob) bool {
	src, ok, err := w.db.SourceByID(ctx, j.SourceID)
	if err != nil {
		w.log.Warn("import load source", "source", j.SourceID, "err", err)
		return false
	}
	if !ok || src.Kind != "youtube" {
		_ = w.db.CompleteImport(ctx, j.SourceID, 0) // source gone / not youtube - resolve it
		return false
	}
	cutoff := w.cutoffFor(ctx, j.SourceID)

	res, err := w.client.ImportPage(ctx, w.db, *src, j.PageToken, cutoff)
	if err != nil {
		var te *TransientError
		if errors.As(err, &te) {
			w.cooldown = importNow().Add(importCooldown) // quota/5xx - pace globally
			if j.Attempts+1 < maxImportAttempts {
				_ = w.db.RetryImport(ctx, j.SourceID, importNow().Add(importBackoff(j.Attempts+1)), err.Error())
			} else {
				_ = w.db.FailImport(ctx, j.SourceID, err.Error())
			}
			return true
		}
		// Permanent (e.g. not a channel feed) - don't spin on it.
		w.log.Info("import giving up", "source", j.SourceID, "err", err)
		_ = w.db.FailImport(ctx, j.SourceID, err.Error())
		return false
	}

	if res.NextPageToken == "" || res.ReachedCutoff {
		_ = w.db.CompleteImport(ctx, j.SourceID, res.Imported)
		w.log.Info("import complete", "source", j.SourceID, "title", src.Title, "new_this_page", res.Imported, "reached_cutoff", res.ReachedCutoff)
	} else {
		_ = w.db.AdvanceImport(ctx, j.SourceID, res.NextPageToken, res.Imported)
	}
	return false
}

// cutoffFor turns the source's resolved archive window into the oldest publish time
// to import. Evergreen (-1) returns the zero time = no limit (full history).
func (w *ImportWorker) cutoffFor(ctx context.Context, sourceID int64) time.Time {
	days, err := w.db.ResolvedArchiveDays(ctx, sourceID)
	if err != nil {
		w.log.Warn("import resolve window", "source", sourceID, "err", err)
		days = store.GlobalArchiveAfterDays
	}
	if days < 0 {
		return time.Time{} // evergreen: no cutoff
	}
	return importNow().AddDate(0, 0, -days)
}

func importBackoff(attempt int) time.Duration {
	d := importBackoffBase
	for i := 1; i < attempt; i++ {
		d *= 2
		if d >= time.Hour {
			return time.Hour
		}
	}
	return d
}

func sleep(ctx context.Context, d time.Duration) {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
	case <-t.C:
	}
}
