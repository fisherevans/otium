package store

import (
	"context"
	"errors"
	"testing"
	"time"
)

// seedItem inserts a source + item and returns the item id, for collection tests.
func seedItem(t *testing.T, db *DB, userID int64, ext string) int64 {
	t.Helper()
	ctx := context.Background()
	s, err := db.CreateSource(ctx, &Source{UserID: userID, Title: "S-" + ext, FeedURL: "http://s/" + ext, State: "followed", Weight: 1})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.UpsertItem(ctx, &Item{SourceID: s.ID, ExternalID: ext, URL: "u", Title: ext, PublishedAt: time.Now().UTC()}); err != nil {
		t.Fatal(err)
	}
	var id int64
	if err := db.sql.QueryRowContext(ctx, `SELECT id FROM items WHERE source_id = ? AND external_id = ?`, s.ID, ext).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func collBySlug(t *testing.T, cols []Collection, slug string) Collection {
	t.Helper()
	for _, c := range cols {
		if c.Slug == slug {
			return c
		}
	}
	t.Fatalf("collection %q not found in %+v", slug, cols)
	return Collection{}
}

// TestEnsureBuiltinCollectionsIdempotent verifies the three builtins are seeded
// once, are order-stable, and re-seeding is a no-op (no dupes, no error).
func TestEnsureBuiltinCollectionsIdempotent(t *testing.T) {
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

	for i := 0; i < 3; i++ {
		if err := db.EnsureBuiltinCollections(ctx, u.ID); err != nil {
			t.Fatalf("seed pass %d: %v", i, err)
		}
	}
	cols, err := db.ListCollections(ctx, u.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(cols) != 3 {
		t.Fatalf("want 3 builtins, got %d: %+v", len(cols), cols)
	}
	// Order is Saved, Watch Later, Liked (seed order).
	wantOrder := []string{SlugSaved, SlugWatchLater, SlugLiked}
	for i, c := range cols {
		if c.Slug != wantOrder[i] {
			t.Fatalf("order[%d] = %q, want %q", i, c.Slug, wantOrder[i])
		}
		if c.Kind != CollectionKindBuiltin {
			t.Fatalf("%q kind = %q, want builtin", c.Slug, c.Kind)
		}
	}
}

// TestCollectionMembership covers add/remove, idempotent add, the item-scoped
// Contains flag, and newest-first browse order.
func TestCollectionMembership(t *testing.T) {
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
	if err := db.EnsureBuiltinCollections(ctx, u.ID); err != nil {
		t.Fatal(err)
	}
	saved := collBySlug(t, mustList(t, db, u.ID, 0), SlugSaved)

	item1 := seedItem(t, db, u.ID, "one")
	item2 := seedItem(t, db, u.ID, "two")

	// Add item1, then add again (idempotent - stays one member).
	if err := db.AddItemToCollection(ctx, u.ID, saved.ID, item1); err != nil {
		t.Fatal(err)
	}
	if err := db.AddItemToCollection(ctx, u.ID, saved.ID, item1); err != nil {
		t.Fatal(err)
	}
	items, err := db.CollectionItems(ctx, u.ID, saved.ID, SortSaved)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].ID != item1 {
		t.Fatalf("after idempotent add want [item1], got %+v", items)
	}

	// Contains flag reflects membership per item.
	cols := mustList(t, db, u.ID, item1)
	if c := collBySlug(t, cols, SlugSaved); c.Contains == nil || !*c.Contains {
		t.Fatalf("Saved should contain item1: %+v", c)
	}
	if c := collBySlug(t, cols, SlugLiked); c.Contains == nil || *c.Contains {
		t.Fatalf("Liked should not contain item1: %+v", c)
	}
	if c := collBySlug(t, mustList(t, db, u.ID, item2), SlugSaved); c.Contains == nil || *c.Contains {
		t.Fatalf("Saved should not contain item2: %+v", c)
	}

	// Add item2 later - it must sort first (newest added first).
	if err := db.AddItemToCollection(ctx, u.ID, saved.ID, item2); err != nil {
		t.Fatal(err)
	}
	items, _ = db.CollectionItems(ctx, u.ID, saved.ID, SortSaved)
	if len(items) != 2 || items[0].ID != item2 {
		t.Fatalf("want newest-first [item2, item1], got %+v", items)
	}

	// Remove item1.
	if err := db.RemoveItemFromCollection(ctx, u.ID, saved.ID, item1); err != nil {
		t.Fatal(err)
	}
	items, _ = db.CollectionItems(ctx, u.ID, saved.ID, SortSaved)
	if len(items) != 1 || items[0].ID != item2 {
		t.Fatalf("after remove want [item2], got %+v", items)
	}
}

// TestLikeWiringToLikedCollection locks the Like -> Liked membership behavior
// used by the ItemEvent handler: AddItemToBuiltinCollection seeds Liked if
// absent and adds; the remove path takes it back out. Neither touches
// item_state, so the ranker's like/skip signal is unaffected (asserted here).
func TestLikeWiringToLikedCollection(t *testing.T) {
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
	item := seedItem(t, db, u.ID, "liked-one")

	// Add to Liked without pre-seeding builtins - the wiring must seed on demand.
	if err := db.AddItemToBuiltinCollection(ctx, u.ID, SlugLiked, item); err != nil {
		t.Fatal(err)
	}
	liked := collBySlug(t, mustList(t, db, u.ID, item), SlugLiked)
	if liked.Contains == nil || !*liked.Contains {
		t.Fatalf("Liked should contain the liked item: %+v", liked)
	}
	if liked.ItemCount != 1 {
		t.Fatalf("Liked count = %d, want 1", liked.ItemCount)
	}

	// The like membership must NOT have written item_state (that's the ranker's
	// signal, which #57 must leave alone).
	var stateRows int
	if err := db.sql.QueryRowContext(ctx, `SELECT COUNT(*) FROM item_state WHERE user_id = ? AND item_id = ?`, u.ID, item).Scan(&stateRows); err != nil {
		t.Fatal(err)
	}
	if stateRows != 0 {
		t.Fatalf("adding to Liked wrote %d item_state rows; must write 0", stateRows)
	}

	// Un-like removes membership, still no item_state.
	if err := db.RemoveItemFromBuiltinCollection(ctx, u.ID, SlugLiked, item); err != nil {
		t.Fatal(err)
	}
	liked = collBySlug(t, mustList(t, db, u.ID, item), SlugLiked)
	if liked.Contains == nil || *liked.Contains {
		t.Fatalf("Liked should no longer contain the item: %+v", liked)
	}
}

// TestCollectionItemsSort locks the #89 review sort: SortSaved orders by
// added_at (when it was saved), SortPublished by published_at (when it ran).
// The setup makes the two orders diverge - the item published earlier is saved
// later - so a sort that ignored its param would fail. added_at is also carried
// back on every row.
func TestCollectionItemsSort(t *testing.T) {
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
	if err := db.EnsureBuiltinCollections(ctx, u.ID); err != nil {
		t.Fatal(err)
	}
	saved := collBySlug(t, mustList(t, db, u.ID, 0), SlugSaved)

	s, err := db.CreateSource(ctx, &Source{UserID: u.ID, Title: "S", FeedURL: "http://s", State: "followed", Weight: 1})
	if err != nil {
		t.Fatal(err)
	}
	// older published earlier; newer published later.
	older := seedItemPub(t, db, s.ID, "older", time.Now().Add(-72*time.Hour).UTC())
	newer := seedItemPub(t, db, s.ID, "newer", time.Now().Add(-1*time.Hour).UTC())

	// Save both, then stamp explicit added_at values (the default is second-
	// granularity, too coarse to order two same-second inserts). older is saved
	// later, so saved-order (newest-added first) is [older, newer] - the inverse
	// of published-order [newer, older].
	if err := db.AddItemToCollection(ctx, u.ID, saved.ID, newer); err != nil {
		t.Fatal(err)
	}
	if err := db.AddItemToCollection(ctx, u.ID, saved.ID, older); err != nil {
		t.Fatal(err)
	}
	stamp := func(itemID int64, at time.Time) {
		if _, err := db.sql.ExecContext(ctx, `UPDATE collection_items SET added_at = ? WHERE collection_id = ? AND item_id = ?`,
			at.UTC().Format("2006-01-02 15:04:05"), saved.ID, itemID); err != nil {
			t.Fatal(err)
		}
	}
	stamp(newer, time.Now().Add(-48*time.Hour)) // saved earlier
	stamp(older, time.Now().Add(-1*time.Hour))  // saved later (newest-added)

	bySaved, err := db.CollectionItems(ctx, u.ID, saved.ID, SortSaved)
	if err != nil {
		t.Fatal(err)
	}
	if len(bySaved) != 2 || bySaved[0].ID != older || bySaved[1].ID != newer {
		t.Fatalf("SortSaved want [older, newer], got %+v", bySaved)
	}
	if bySaved[0].AddedAt.IsZero() {
		t.Fatalf("SortSaved must carry added_at, got zero: %+v", bySaved[0])
	}

	byPub, err := db.CollectionItems(ctx, u.ID, saved.ID, SortPublished)
	if err != nil {
		t.Fatal(err)
	}
	if len(byPub) != 2 || byPub[0].ID != newer || byPub[1].ID != older {
		t.Fatalf("SortPublished want [newer, older], got %+v", byPub)
	}

	// An unrecognized sort falls back to Saved order.
	byDefault, err := db.CollectionItems(ctx, u.ID, saved.ID, "bogus")
	if err != nil {
		t.Fatal(err)
	}
	if len(byDefault) != 2 || byDefault[0].ID != older {
		t.Fatalf("unknown sort should fall back to Saved order, got %+v", byDefault)
	}
}

// seedItemPub inserts an item on an existing source with an explicit published
// time and returns its id, for the sort test.
func seedItemPub(t *testing.T, db *DB, sourceID int64, ext string, pub time.Time) int64 {
	t.Helper()
	ctx := context.Background()
	if _, err := db.UpsertItem(ctx, &Item{SourceID: sourceID, ExternalID: ext, URL: "u", Title: ext, PublishedAt: pub}); err != nil {
		t.Fatal(err)
	}
	var id int64
	if err := db.sql.QueryRowContext(ctx, `SELECT id FROM items WHERE source_id = ? AND external_id = ?`, sourceID, ext).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

// TestBuiltinsProtected verifies builtins refuse rename/delete and user lists
// allow both.
func TestBuiltinsProtected(t *testing.T) {
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
	if err := db.EnsureBuiltinCollections(ctx, u.ID); err != nil {
		t.Fatal(err)
	}
	saved := collBySlug(t, mustList(t, db, u.ID, 0), SlugSaved)

	if err := db.RenameCollection(ctx, u.ID, saved.ID, "Nope"); !errors.Is(err, ErrCollectionProtected) {
		t.Fatalf("rename builtin err = %v, want ErrCollectionProtected", err)
	}
	if err := db.DeleteCollection(ctx, u.ID, saved.ID); !errors.Is(err, ErrCollectionProtected) {
		t.Fatalf("delete builtin err = %v, want ErrCollectionProtected", err)
	}

	// A user list is renamable and deletable.
	c, err := db.CreateCollection(ctx, u.ID, "Read Later at Lunch", "read-later-at-lunch")
	if err != nil {
		t.Fatal(err)
	}
	if c.Kind != CollectionKindUser {
		t.Fatalf("created kind = %q, want user", c.Kind)
	}
	if err := db.RenameCollection(ctx, u.ID, c.ID, "Lunch Reads"); err != nil {
		t.Fatalf("rename user list: %v", err)
	}
	if err := db.DeleteCollection(ctx, u.ID, c.ID); err != nil {
		t.Fatalf("delete user list: %v", err)
	}
	if len(mustList(t, db, u.ID, 0)) != 3 {
		t.Fatal("after deleting the user list only the 3 builtins should remain")
	}
}

// TestCreateCollectionSlugCollision verifies duplicate names get a suffixed slug
// rather than failing the create.
func TestCreateCollectionSlugCollision(t *testing.T) {
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
	a, err := db.CreateCollection(ctx, u.ID, "News", "news")
	if err != nil {
		t.Fatal(err)
	}
	b, err := db.CreateCollection(ctx, u.ID, "News", "news")
	if err != nil {
		t.Fatal(err)
	}
	if a.Slug == b.Slug {
		t.Fatalf("collision not resolved: both slugs are %q", a.Slug)
	}
	if b.Slug != "news-2" {
		t.Fatalf("second slug = %q, want news-2", b.Slug)
	}
}

func mustList(t *testing.T, db *DB, userID, itemID int64) []Collection {
	t.Helper()
	cols, err := db.ListCollections(context.Background(), userID, itemID)
	if err != nil {
		t.Fatal(err)
	}
	return cols
}
