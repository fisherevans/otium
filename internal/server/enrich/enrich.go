// Package enrich runs a durable, out-of-band metadata enrichment worker. Items
// carry metadata their feed doesn't ship (YouTube video duration today; article
// engagement or other scoring facets later). The worker is generic: it dispatches
// to a registry of Enrichers keyed by a "kind" string, and owns all the policy
// (retries with exponential backoff, a global cooldown on rate-limiting, giving up
// after a max attempt count). All state is in the DB (item_enrichment + a meta
// cursor), so a restart resumes exactly where it left off - nothing lives in memory.
//
// Two durable mechanisms, both driven by the single Run loop:
//   - sweep:   walk items by id from a persisted cursor, offering each to every
//     enricher's Wants(); enqueue a pending task when wanted. Because new
//     items get higher ids, this same sweep enqueues both the backlog
//     (backfill) and freshly-ingested items - no separate path.
//   - process: pull due pending tasks and run their enricher, applying the retry /
//     backoff / cooldown / give-up policy.
package enrich

import (
	"context"
	"log/slog"
	"strconv"
	"time"

	"github.com/fisherevans/otium/internal/server/store"
)

// Enricher is one pluggable integration. Implementations are trusted internal code.
type Enricher interface {
	// Kind is the stable queue key for this enricher (stored in item_enrichment.kind).
	Kind() string
	// Wants reports whether this item needs this enrichment (cheap, no I/O).
	Wants(c store.EnrichCandidate) bool
	// Enrich fetches the metadata and applies it (e.g. db.SetItemDuration). The
	// returned Result plus err drive the worker's policy:
	//   err == nil                 -> success, mark done
	//   err != nil, Retryable      -> transient (network / 5xx / rate limit); reschedule
	//   err != nil, !Retryable     -> permanent (no data); mark failed
	//   Result.Cooldown > 0        -> pause the WHOLE worker this long (rate limited)
	Enrich(ctx context.Context, db *store.DB, c store.EnrichCandidate) (Result, error)
}

// Result carries per-call policy hints beyond the error.
type Result struct {
	Retryable bool
	Cooldown  time.Duration // >0 pauses all processing (a global rate-limit signal)
}

// Tunables. Deliberately gentle - this is background enrichment, not a race. The
// few used by tests are vars so they can be tightened without a 6h backoff wait.
const (
	tickInterval   = 20 * time.Second
	sweepBatch     = 200 // items scanned per sweep tick (cheap, id-indexed)
	processBatch   = 15  // enrichments attempted per tick
	backoffCap     = 6 * time.Hour
	cursorKey      = "enrich_sweep_cursor"
	defaultCooldwn = 10 * time.Minute
)

var (
	politeDelay = 1500 * time.Millisecond // pause between external calls
	maxAttempts = 8                       // give up after this many tries ("not available")
	backoffBase = 30 * time.Second        // first retry delay; doubles each attempt
)

type Worker struct {
	db       *store.DB
	log      *slog.Logger
	byKind   map[string]Enricher
	all      []Enricher
	cooldown time.Time // no processing until this time (rate-limit backoff)
}

func NewWorker(db *store.DB, log *slog.Logger, enrichers ...Enricher) *Worker {
	w := &Worker{db: db, log: log, byKind: map[string]Enricher{}}
	for _, e := range enrichers {
		w.byKind[e.Kind()] = e
		w.all = append(w.all, e)
	}
	return w
}

// Run drives the worker until ctx is cancelled. Safe to call as a goroutine.
func (w *Worker) Run(ctx context.Context) {
	if len(w.all) == 0 {
		return
	}
	w.log.Info("enrich worker starting", "kinds", len(w.all))
	t := time.NewTicker(tickInterval)
	defer t.Stop()
	for {
		w.sweep(ctx)
		w.process(ctx)
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// sweep advances the durable cursor, enqueuing wanted items (backlog + new).
func (w *Worker) sweep(ctx context.Context) {
	cur, err := w.db.MetaGet(ctx, cursorKey)
	if err != nil {
		w.log.Warn("enrich sweep: cursor read", "err", err)
		return
	}
	after := atoi(cur)
	items, err := w.db.ItemsAfter(ctx, after, sweepBatch)
	if err != nil {
		w.log.Warn("enrich sweep: query", "err", err)
		return
	}
	if len(items) == 0 {
		return // cursor at the end; new items (higher ids) get picked up next tick
	}
	enqueued := 0
	for _, it := range items {
		for _, e := range w.all {
			if e.Wants(it) {
				if err := w.db.EnqueueEnrichment(ctx, it.ID, e.Kind()); err != nil {
					w.log.Warn("enrich enqueue", "item", it.ID, "kind", e.Kind(), "err", err)
					continue
				}
				enqueued++
			}
		}
	}
	last := items[len(items)-1].ID
	if err := w.db.MetaSet(ctx, cursorKey, itoa(last)); err != nil {
		w.log.Warn("enrich sweep: cursor write", "err", err)
	}
	if enqueued > 0 {
		w.log.Info("enrich sweep", "scanned", len(items), "enqueued", enqueued, "cursor", last)
	}
}

// process runs due enrichments under the retry/backoff/cooldown policy.
func (w *Worker) process(ctx context.Context) {
	if now().Before(w.cooldown) {
		return
	}
	due, err := w.db.DueEnrichments(ctx, now(), processBatch)
	if err != nil {
		w.log.Warn("enrich due query", "err", err)
		return
	}
	for _, t := range due {
		if ctx.Err() != nil {
			return
		}
		e := w.byKind[t.Kind]
		if e == nil {
			_ = w.db.FailEnrichment(ctx, t.ItemID, t.Kind, "no enricher registered for kind")
			continue
		}
		c, ok, err := w.db.EnrichCandidateByID(ctx, t.ItemID)
		if err != nil {
			w.log.Warn("enrich load item", "item", t.ItemID, "err", err)
			continue
		}
		if !ok || !e.Wants(c) {
			// The item vanished or no longer needs it (already enriched some other
			// way) - resolve the task so it stops recurring.
			_ = w.db.CompleteEnrichment(ctx, t.ItemID, t.Kind)
			continue
		}
		res, err := e.Enrich(ctx, w.db, c)
		if res.Cooldown > 0 {
			w.cooldown = now().Add(res.Cooldown)
			w.log.Warn("enrich rate-limited, cooling down", "kind", t.Kind, "until", w.cooldown)
		}
		switch {
		case err == nil:
			_ = w.db.CompleteEnrichment(ctx, t.ItemID, t.Kind)
		case res.Retryable && t.Attempts+1 < maxAttempts:
			_ = w.db.RetryEnrichment(ctx, t.ItemID, t.Kind, now().Add(backoff(t.Attempts+1)), err.Error())
		default:
			w.log.Info("enrich giving up", "item", t.ItemID, "kind", t.Kind, "attempts", t.Attempts+1, "err", err)
			_ = w.db.FailEnrichment(ctx, t.ItemID, t.Kind, err.Error())
		}
		if res.Cooldown > 0 {
			return // stop this batch; the global cooldown is in effect
		}
		sleep(ctx, politeDelay)
	}
}

// backoff is exponential (base * 2^(n-1)) capped, giving ~30s, 1m, 2m, ... up to 6h.
func backoff(attempt int) time.Duration {
	d := backoffBase
	for i := 1; i < attempt; i++ {
		d *= 2
		if d >= backoffCap {
			return backoffCap
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

// now is a var so it doesn't need wall-clock stubbing in tests beyond reassignment.
var now = time.Now

func atoi(s string) int64 { v, _ := strconv.ParseInt(s, 10, 64); return v }
func itoa(v int64) string { return strconv.FormatInt(v, 10) }
