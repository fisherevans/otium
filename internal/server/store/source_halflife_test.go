package store

import (
	"context"
	"testing"
	"time"
)

// mkUserSourceItem builds a user with one source and one item, for the half-life
// resolution tests.
func mkUserSourceItem(t *testing.T, db *DB) (ctx context.Context, uid, sid int64) {
	t.Helper()
	ctx = context.Background()
	u, err := db.UpsertUserByUsername(ctx, "tester", "")
	if err != nil {
		t.Fatal(err)
	}
	s, err := db.CreateSource(ctx, &Source{UserID: u.ID, Title: "Src", FeedURL: "http://src", State: "followed", Weight: 1})
	if err != nil {
		t.Fatal(err)
	}
	it := &Item{SourceID: s.ID, ExternalID: "m-1", URL: "u", Title: "m-1", PublishedAt: time.Now().UTC().Add(-24 * time.Hour)}
	if _, err := db.UpsertItem(ctx, it); err != nil {
		t.Fatal(err)
	}
	return ctx, u.ID, s.ID
}

// setSourceInterestWithHalfLife creates a interest with the given half-life and assigns
// the source to it as its ONE interest (#86). Reassigning moves the source.
func setSourceInterestWithHalfLife(t *testing.T, db *DB, ctx context.Context, uid, sid int64, name, slug string, halfLife float64) {
	t.Helper()
	f, err := db.CreateInterest(ctx, uid, name, slug, "")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.UpdateInterest(ctx, uid, f.ID, nil, nil, nil, &halfLife, nil, nil); err != nil {
		t.Fatal(err)
	}
	if err := db.AssignSourceInterest(ctx, sid, f.ID); err != nil {
		t.Fatal(err)
	}
}

// TestCandidateResolvesOneFeedHalfLife covers #86: the candidate's interest half-life
// comes directly from the source's one interest, with no multi-interest rule. Changing
// the source's interest changes the resolved half-life.
func TestCandidateResolvesOneFeedHalfLife(t *testing.T) {
	db, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx, uid, sid := mkUserSourceItem(t, db)

	// No interest yet: interest half-life resolves to 0 (global fallback).
	pool, err := db.Candidates(ctx, uid, nil, 45, 500)
	if err != nil {
		t.Fatal(err)
	}
	if len(pool) != 1 || pool[0].InterestHalfLifeDays != 0 {
		t.Fatalf("interestless source should resolve interest half-life 0, got %+v", pool)
	}

	// Assign to a 14d interest: candidate reads 14.
	setSourceInterestWithHalfLife(t, db, ctx, uid, sid, "News", "news", 14)
	pool, err = db.Candidates(ctx, uid, nil, 45, 500)
	if err != nil {
		t.Fatal(err)
	}
	if pool[0].InterestHalfLifeDays != 14 {
		t.Fatalf("one-interest half-life should be 14, got %v", pool[0].InterestHalfLifeDays)
	}

	// Move it to a 45d interest: candidate now reads 45 (no ambiguity, no rule).
	setSourceInterestWithHalfLife(t, db, ctx, uid, sid, "Evergreen", "evergreen", 45)
	pool, err = db.Candidates(ctx, uid, nil, 45, 500)
	if err != nil {
		t.Fatal(err)
	}
	if pool[0].InterestHalfLifeDays != 45 {
		t.Fatalf("after reassign, one-interest half-life should be 45, got %v", pool[0].InterestHalfLifeDays)
	}
}

// TestSourceHalfLifeOverridePlumbing verifies the per-source override flows onto
// the candidate (SourceHalfLifeDays) and round-trips through UpdateSource /
// ListSources (#76). The session ranker applies the source > interest precedence.
func TestSourceHalfLifeOverridePlumbing(t *testing.T) {
	db, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx, uid, sid := mkUserSourceItem(t, db)

	// Default: no override -> 0 on both the candidate and the listed source.
	pool, err := db.Candidates(ctx, uid, nil, 45, 500)
	if err != nil {
		t.Fatal(err)
	}
	if pool[0].SourceHalfLifeDays != 0 {
		t.Fatalf("unset source half-life should be 0, got %v", pool[0].SourceHalfLifeDays)
	}

	hl := 9.0
	if err := db.UpdateSource(ctx, uid, sid, nil, nil, nil, &hl, nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	pool, err = db.Candidates(ctx, uid, nil, 45, 500)
	if err != nil {
		t.Fatal(err)
	}
	if pool[0].SourceHalfLifeDays != 9 {
		t.Fatalf("candidate SourceHalfLifeDays should be 9 after update, got %v", pool[0].SourceHalfLifeDays)
	}
	srcs, err := db.ListSources(ctx, uid)
	if err != nil {
		t.Fatal(err)
	}
	if srcs[0].HalfLifeDays != 9 {
		t.Fatalf("ListSources should expose half_life_days 9, got %v", srcs[0].HalfLifeDays)
	}
}

// TestMigrateAddsSourceHalfLifeIdempotent verifies the additive
// sources.half_life_days column exists on a fresh schema and survives reruns.
func TestMigrateAddsSourceHalfLifeIdempotent(t *testing.T) {
	db, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if !hasColumn(t, db.sql, "sources", "half_life_days") {
		t.Fatal("fresh schema missing sources.half_life_days")
	}
	if err := migrate(db.sql); err != nil {
		t.Fatalf("re-migrate: %v", err)
	}
}
