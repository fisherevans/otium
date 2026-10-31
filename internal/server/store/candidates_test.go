package store

import (
	"context"
	"math"
	"testing"
	"time"
)

// TestCandidatesPoolShape pins what the session build relies on from Candidates
// (#186): the newest-`limit` cut over unseen items, recency_rank among a source's
// unseen items, cadence over every stored item in the window (seen included), and
// bodies left out of the pool but available through ItemContents.
func TestCandidatesPoolShape(t *testing.T) {
	db, uid := newTestDB(t)
	ctx := context.Background()
	now := time.Now().UTC()

	mkSource := func(title string) int64 {
		s, err := db.CreateSource(ctx, &Source{UserID: uid, Title: title, FeedURL: "http://" + title, State: "followed", Weight: 1})
		if err != nil {
			t.Fatal(err)
		}
		return s.ID
	}
	mkItem := func(sid int64, ext string, age time.Duration) {
		it := &Item{SourceID: sid, ExternalID: ext, URL: "u/" + ext, Title: ext, Content: "<p>" + ext + "</p>", PublishedAt: now.Add(-age)}
		if _, err := db.UpsertItem(ctx, it); err != nil {
			t.Fatal(err)
		}
	}
	day := 24 * time.Hour
	a := mkSource("a")
	mkItem(a, "a-1", 1*day)
	mkItem(a, "a-2", 2*day)
	mkItem(a, "a-3", 4*day) // seen below: out of the pool, still in the cadence window
	mkItem(a, "a-4", 30*day)
	mkItem(a, "a-old", 100*day) // outside the 45-day window
	b := mkSource("b")
	mkItem(b, "b-1", 3*day)

	all, err := db.Candidates(ctx, uid, nil, 45, 100)
	if err != nil {
		t.Fatal(err)
	}
	byTitle := map[string]Candidate{}
	for _, c := range all {
		byTitle[c.Title] = c
	}
	if err := db.SetItemState(ctx, uid, byTitle["a-3"].ID, "skipped"); err != nil {
		t.Fatal(err)
	}

	pool, err := db.Candidates(ctx, uid, nil, 45, 4)
	if err != nil {
		t.Fatal(err)
	}
	var titles []string
	for _, c := range pool {
		titles = append(titles, c.Title)
	}
	if want := []string{"a-1", "a-2", "b-1", "a-4"}; len(titles) != len(want) || titles[0] != want[0] || titles[1] != want[1] || titles[2] != want[2] || titles[3] != want[3] {
		t.Fatalf("pool = %v, want %v", titles, want)
	}
	wantRank := map[string]int{"a-1": 1, "a-2": 2, "b-1": 1, "a-4": 3}
	for _, c := range pool {
		if c.RecencyRank != wantRank[c.Title] {
			t.Errorf("%s recency_rank = %d, want %d", c.Title, c.RecencyRank, wantRank[c.Title])
		}
		if c.Content != "" {
			t.Errorf("%s content loaded into the pool", c.Title)
		}
	}
	// Source a: 4 items in the 45-day window (a-3 seen still counts), earliest 30 days ago.
	if got, want := byTitle["a-1"].SourceCadence, 4.0/30; math.Abs(got-want) > 1e-3 {
		t.Errorf("source a cadence = %v, want %v", got, want)
	}
	if got, want := byTitle["b-1"].SourceCadence, 1.0/3; math.Abs(got-want) > 1e-3 {
		t.Errorf("source b cadence = %v, want %v", got, want)
	}

	contents, err := db.ItemContents(ctx, uid, []int64{pool[0].ID, pool[2].ID})
	if err != nil {
		t.Fatal(err)
	}
	if contents[pool[0].ID] != "<p>a-1</p>" || contents[pool[2].ID] != "<p>b-1</p>" || len(contents) != 2 {
		t.Fatalf("contents = %v", contents)
	}
}
