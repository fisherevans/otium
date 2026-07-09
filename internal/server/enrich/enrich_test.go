package enrich

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/fisherevans/otium/internal/server/store"
)

// fakeEnricher drives the worker through its policy paths without any network.
type fakeEnricher struct {
	fn    func(c store.EnrichCandidate) (Result, error)
	calls int
}

func (f *fakeEnricher) Kind() string { return "fake" }
func (f *fakeEnricher) Wants(c store.EnrichCandidate) bool {
	return c.SourceKind == "youtube" && c.DurationSec == 0
}
func (f *fakeEnricher) Enrich(_ context.Context, _ *store.DB, c store.EnrichCandidate) (Result, error) {
	f.calls++
	return f.fn(c)
}

func testWorker(t *testing.T, e Enricher) (*store.DB, *Worker, store.EnrichCandidate) {
	t.Helper()
	db, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	ctx := context.Background()
	u, err := db.UpsertUserByUsername(ctx, "t", "")
	if err != nil {
		t.Fatal(err)
	}
	s, err := db.CreateSource(ctx, &store.Source{UserID: u.ID, Kind: "youtube", Title: "Chan", FeedURL: "http://x", State: "followed", Weight: 1})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.UpsertItem(ctx, &store.Item{
		SourceID: s.ID, ExternalID: "v1", URL: "https://www.youtube.com/watch?v=1",
		Title: "V", MediaType: "long", PublishedAt: time.Now().UTC(),
	}); err != nil {
		t.Fatal(err)
	}
	cands, err := db.ItemsAfter(ctx, 0, 10)
	if err != nil || len(cands) != 1 {
		t.Fatalf("ItemsAfter: %v (n=%d)", err, len(cands))
	}
	return db, NewWorker(db, slog.New(slog.NewTextHandler(io.Discard, nil)), e), cands[0]
}

func pending(t *testing.T, db *store.DB) int {
	t.Helper()
	n, err := db.CountPendingEnrichments(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return n
}

// TestSweepThenSuccess: the sweep enqueues the wanted item, process runs it, and a
// success marks it done + applies the duration.
func TestSweepThenSuccess(t *testing.T) {
	politeDelay = 0
	fake := &fakeEnricher{fn: func(c store.EnrichCandidate) (Result, error) { return Result{}, nil }}
	db, w, cand := testWorker(t, fake)
	ctx := context.Background()

	w.sweep(ctx)
	if got := pending(t, db); got != 1 {
		t.Fatalf("sweep should enqueue 1, got %d", got)
	}
	// A second sweep advances the cursor past the item and must not re-enqueue.
	w.sweep(ctx)
	if got := pending(t, db); got != 1 {
		t.Fatalf("re-sweep should not duplicate, got %d", got)
	}

	w.process(ctx)
	if fake.calls != 1 {
		t.Fatalf("enricher should run once, got %d", fake.calls)
	}
	if got := pending(t, db); got != 0 {
		t.Fatalf("success should clear the queue, got %d pending", got)
	}
	_ = cand
}

// TestRetryThenGiveUp: transient failures reschedule with backoff (not due until the
// clock advances) and, after maxAttempts, the task is marked failed - not retried
// forever.
func TestRetryThenGiveUp(t *testing.T) {
	politeDelay = 0
	backoffBase = time.Minute
	maxAttempts = 3
	defer func() { maxAttempts = 8; backoffBase = 30 * time.Second }()

	fake := &fakeEnricher{fn: func(c store.EnrichCandidate) (Result, error) {
		return Result{Retryable: true}, errors.New("boom")
	}}
	db, w, _ := testWorker(t, fake)
	ctx := context.Background()
	w.sweep(ctx)

	base := time.Now()
	now = func() time.Time { return base }
	defer func() { now = time.Now }()

	// Attempt 1: due now -> retry scheduled ~1m out.
	w.process(ctx)
	if pending(t, db) != 1 {
		t.Fatal("still pending after first transient failure")
	}
	// Not due yet -> process is a no-op.
	before := fake.calls
	w.process(ctx)
	if fake.calls != before {
		t.Fatal("task ran before its backoff elapsed")
	}
	// Advance past each backoff and let it exhaust its attempts.
	for i := 0; i < 5; i++ {
		base = base.Add(24 * time.Hour)
		w.process(ctx)
	}
	if got := pending(t, db); got != 0 {
		t.Fatalf("task should have given up (0 pending), got %d", got)
	}
	if fake.calls != maxAttempts {
		t.Fatalf("should stop after %d attempts, ran %d", maxAttempts, fake.calls)
	}
}

func TestBackoffGrowsAndCaps(t *testing.T) {
	backoffBase = 30 * time.Second
	if got := backoff(1); got != 30*time.Second {
		t.Fatalf("attempt 1 = %v", got)
	}
	if got := backoff(3); got != 2*time.Minute {
		t.Fatalf("attempt 3 = %v", got)
	}
	if got := backoff(50); got != backoffCap {
		t.Fatalf("attempt 50 should cap at %v, got %v", backoffCap, got)
	}
}
