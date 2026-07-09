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
	bound := w.boundFor(ctx, j.SourceID)
	bound.SeenBefore = j.Seen

	res, err := w.client.ImportPage(ctx, w.db, *src, j.PageToken, bound)
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
		_ = w.db.AdvanceImport(ctx, j.SourceID, res.NextPageToken, res.Imported, res.Seen)
	}
	return false
}

// boundFor turns the source's resolved archive rule (#124) into the import depth
// bound: the age cutoff (evergreen -> zero time = no age limit), the keep-latest-N
// count, and how they combine. So a count-capped source imports only its newest N
// videos; an age-capped one stops at the age cutoff; evergreen + no count fetches
// the whole catalog.
func (w *ImportWorker) boundFor(ctx context.Context, sourceID int64) ImportBound {
	rule, err := w.db.ResolvedArchiveRule(ctx, sourceID)
	if err != nil {
		w.log.Warn("import resolve rule", "source", sourceID, "err", err)
		rule = store.ArchiveRule{Days: store.GlobalArchiveAfterDays, Combine: "and"}
	}
	b := ImportBound{MaxCount: rule.KeepCount, Combine: rule.Combine}
	if rule.Days >= 0 {
		b.Cutoff = importNow().AddDate(0, 0, -rule.Days)
	}
	return b
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
