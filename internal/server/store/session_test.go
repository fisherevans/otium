package store

import (
	"context"
	"testing"
)

// TestSessionLifecycle locks the durable-session contract (#67): create stores
// the queue + cursor, current returns the active one, a new create ends the
// prior (one active per user), cursor advances persist, and ending flips status.
func TestSessionLifecycle(t *testing.T) {
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

	// No active session yet.
	if s, err := db.CurrentSession(ctx, u.ID); err != nil || s != nil {
		t.Fatalf("expected no current session, got %v (err %v)", s, err)
	}

	// Create one.
	if err := db.CreateSession(ctx, "sess1", u.ID, 20, []string{"comedy", "news"}, []int64{3, 1, 2}); err != nil {
		t.Fatal(err)
	}
	s, err := db.CurrentSession(ctx, u.ID)
	if err != nil || s == nil {
		t.Fatalf("expected current session, err %v", err)
	}
	if s.ID != "sess1" || s.DurationMin != 20 || s.Cursor != 0 || s.Status != "active" {
		t.Fatalf("unexpected session: %+v", s)
	}
	if got, want := s.ItemIDs, []int64{3, 1, 2}; !equalInts(got, want) {
		t.Fatalf("item_ids preserved order: got %v want %v", got, want)
	}
	if got, want := s.Themes, []string{"comedy", "news"}; len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("themes: got %v want %v", got, want)
	}

	// Advance the cursor; it persists.
	if err := db.UpdateSessionCursor(ctx, u.ID, "sess1", 2); err != nil {
		t.Fatal(err)
	}
	if s, _ := db.CurrentSession(ctx, u.ID); s == nil || s.Cursor != 2 {
		t.Fatalf("cursor did not persist: %+v", s)
	}

	// Creating a new session ends the prior one: only the new one is active.
	if err := db.CreateSession(ctx, "sess2", u.ID, 10, nil, []int64{9}); err != nil {
		t.Fatal(err)
	}
	s, _ = db.CurrentSession(ctx, u.ID)
	if s == nil || s.ID != "sess2" {
		t.Fatalf("expected sess2 active, got %+v", s)
	}
	if prev, _ := db.GetSession(ctx, u.ID, "sess1"); prev == nil || prev.Status != "ended" {
		t.Fatalf("expected sess1 ended, got %+v", prev)
	}

	// A cursor write to an ended session is a no-op (still status-guarded).
	if err := db.UpdateSessionCursor(ctx, u.ID, "sess1", 5); err != nil {
		t.Fatal(err)
	}
	if prev, _ := db.GetSession(ctx, u.ID, "sess1"); prev.Cursor != 2 {
		t.Fatalf("ended-session cursor should not move, got %d", prev.Cursor)
	}

	// Ending the active session leaves no current.
	if err := db.EndSession(ctx, u.ID, "sess2"); err != nil {
		t.Fatal(err)
	}
	if s, _ := db.CurrentSession(ctx, u.ID); s != nil {
		t.Fatalf("expected no current after end, got %+v", s)
	}
}

func equalInts(a, b []int64) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
