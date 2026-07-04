package store

import (
	"context"
	"testing"
	"time"
)

// setup builds a user with one source, one item, and feeds the caller wires up.
func mkUserSourceItem(t *testing.T, db *DB) (ctx context.Context, uid, sid int64) {
	t.Helper()
	ctx = context.Background()
	u, err := db.UpsertUserByUsername(ctx, "tester", "")
	if err != nil {
		t.Fatal(err)
	}
	s, err := db.CreateSource(ctx, &Source{UserID: u.ID, Title: "Multi", FeedURL: "http://multi", State: "followed", Weight: 1})
	if err != nil {
		t.Fatal(err)
	}
	it := &Item{SourceID: s.ID, ExternalID: "m-1", URL: "u", Title: "m-1", PublishedAt: time.Now().UTC().Add(-24 * time.Hour)}
	if _, err := db.UpsertItem(ctx, it); err != nil {
		t.Fatal(err)
	}
	return ctx, u.ID, s.ID
}

func setFeed(t *testing.T, db *DB, ctx context.Context, uid, sid int64, name, slug string, sort int, halfLife float64) {
	t.Helper()
	f, err := db.CreateFeed(ctx, uid, name, slug, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.sql.ExecContext(ctx, `UPDATE feeds SET sort = ? WHERE id = ?`, sort, f.ID); err != nil {
		t.Fatal(err)
	}
	if err := db.UpdateFeed(ctx, uid, f.ID, nil, nil, nil, &halfLife, nil); err != nil {
		t.Fatal(err)
	}
	if err := db.AddFeedSource(ctx, f.ID, sid); err != nil {
		t.Fatal(err)
	}
}

// TestMultiFeedRuleResolvesFeedHalfLife covers #76's multi-feed rule: a source in
// several feeds resolves its feed half-life to the primary feed by default, or to
// the shortest/longest EFFECTIVE half-life among its feeds when the user picks
// that rule. Feeds: primary(sort 1, 14d), short(sort 5, 5d), long(sort 9, 45d).
func TestMultiFeedRuleResolvesFeedHalfLife(t *testing.T) {
	db, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx, uid, sid := mkUserSourceItem(t, db)

	setFeed(t, db, ctx, uid, sid, "Primary", "primary", 1, 14) // primary by sort
	setFeed(t, db, ctx, uid, sid, "Short", "short", 5, 5)      // shortest half-life
	setFeed(t, db, ctx, uid, sid, "Long", "long", 9, 45)       // longest half-life

	resolve := func(rule MultiFeedRule) float64 {
		pool, err := db.Candidates(ctx, uid, nil, 45, 500, rule)
		if err != nil {
			t.Fatal(err)
		}
		if len(pool) != 1 {
			t.Fatalf("rule %s: expected 1 candidate, got %d", rule, len(pool))
		}
		return pool[0].FeedHalfLifeDays
	}

	if got := resolve(RulePrimaryFeed); got != 14 {
		t.Fatalf("primary rule should resolve to the primary feed (14d), got %v", got)
	}
	if got := resolve(RuleShortestHalfLife); got != 5 {
		t.Fatalf("shortest rule should resolve to the shortest half-life (5d), got %v", got)
	}
	if got := resolve(RuleLongestHalfLife); got != 45 {
		t.Fatalf("longest rule should resolve to the longest half-life (45d), got %v", got)
	}
}

// TestMultiFeedRuleTreatsInheritAsGlobal verifies the shortest/longest comparison
// counts a feed that inherits the global default (half_life 0) as
// defaultHalfLifeDays, not 0 - otherwise "shortest" would always pick an
// inheriting feed. Feeds: inherit(0 -> 21 effective) and long(45).
func TestMultiFeedRuleTreatsInheritAsGlobal(t *testing.T) {
	db, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx, uid, sid := mkUserSourceItem(t, db)

	setFeed(t, db, ctx, uid, sid, "Inherit", "inherit", 1, 0) // 0 = inherit -> effective 21
	setFeed(t, db, ctx, uid, sid, "Long", "long", 9, 45)

	pool, err := db.Candidates(ctx, uid, nil, 45, 500, RuleShortestHalfLife)
	if err != nil {
		t.Fatal(err)
	}
	// Shortest effective is the inheriting feed (21 < 45). Its stored half_life is
	// 0, but the query selects the EFFECTIVE value, so it comes back as 21.
	if got := pool[0].FeedHalfLifeDays; got != defaultHalfLifeDays {
		t.Fatalf("inheriting feed should read as %v (global) under shortest, got %v", defaultHalfLifeDays, got)
	}

	pool, err = db.Candidates(ctx, uid, nil, 45, 500, RuleLongestHalfLife)
	if err != nil {
		t.Fatal(err)
	}
	if got := pool[0].FeedHalfLifeDays; got != 45 {
		t.Fatalf("longest should pick the 45d feed over the inheriting (21) one, got %v", got)
	}
}

// TestSourceHalfLifeOverridePlumbing verifies the per-source override flows onto
// the candidate (SourceHalfLifeDays) and round-trips through UpdateSource /
// ListSources (#76). The session ranker applies the source > feed precedence.
func TestSourceHalfLifeOverridePlumbing(t *testing.T) {
	db, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx, uid, sid := mkUserSourceItem(t, db)

	// Default: no override -> 0 on both the candidate and the listed source.
	pool, err := db.Candidates(ctx, uid, nil, 45, 500, RulePrimaryFeed)
	if err != nil {
		t.Fatal(err)
	}
	if pool[0].SourceHalfLifeDays != 0 {
		t.Fatalf("unset source half-life should be 0, got %v", pool[0].SourceHalfLifeDays)
	}

	hl := 9.0
	if err := db.UpdateSource(ctx, uid, sid, nil, nil, nil, &hl, nil); err != nil {
		t.Fatal(err)
	}
	pool, err = db.Candidates(ctx, uid, nil, 45, 500, RulePrimaryFeed)
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

// TestMultiFeedRuleSettingRoundTrips verifies the preference persists and
// normalizes unknown input to the primary-feed default (#76).
func TestMultiFeedRuleSettingRoundTrips(t *testing.T) {
	db, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx := context.Background()
	u, err := db.UpsertUserByUsername(ctx, "tester", "")
	if err != nil {
		t.Fatal(err)
	}

	// Default before any write.
	if r, err := db.MultiFeedRule(ctx, u.ID); err != nil || r != RulePrimaryFeed {
		t.Fatalf("default rule = %v (err %v), want primary", r, err)
	}
	if err := db.SetMultiFeedRule(ctx, u.ID, RuleLongestHalfLife); err != nil {
		t.Fatal(err)
	}
	if r, _ := db.MultiFeedRule(ctx, u.ID); r != RuleLongestHalfLife {
		t.Fatalf("persisted rule = %v, want longest", r)
	}
	s, err := db.GetSettings(ctx, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if s.MultiFeedRule != RuleLongestHalfLife {
		t.Fatalf("GetSettings rule = %v, want longest", s.MultiFeedRule)
	}
	// Unknown input coerces to the safe default.
	if err := db.SetMultiFeedRule(ctx, u.ID, "garbage"); err != nil {
		t.Fatal(err)
	}
	if r, _ := db.MultiFeedRule(ctx, u.ID); r != RulePrimaryFeed {
		t.Fatalf("garbage rule should normalize to primary, got %v", r)
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
