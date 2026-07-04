package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// Collection kinds and the reserved builtin slugs. Builtins are seeded per user
// and protected: they can't be renamed or deleted. Liked is driven by the Like
// button (membership follows like/unlike); Saved and Watch Later are populated
// through the Save picker.
const (
	CollectionKindBuiltin = "builtin"
	CollectionKindUser    = "user"

	SlugSaved      = "saved"
	SlugWatchLater = "watch-later"
	SlugLiked      = "liked"
)

// builtinCollections is the seed set, in display order (Sort follows the index).
var builtinCollections = []struct{ name, slug string }{
	{"Saved", SlugSaved},
	{"Watch Later", SlugWatchLater},
	{"Liked", SlugLiked},
}

// ErrCollectionProtected is returned when a rename/delete targets a builtin
// collection (or a collection the user doesn't own). Handlers map it to 400.
var ErrCollectionProtected = errors.New("collection is protected (builtin) or not found")

// EnsureBuiltinCollections seeds the three builtins for a user idempotently. The
// ON CONFLICT DO NOTHING on (user_id, slug) makes it safe to call on every
// collections request; a rename of a builtin's name would be preserved (we only
// insert when absent).
func (db *DB) EnsureBuiltinCollections(ctx context.Context, userID int64) error {
	for i, b := range builtinCollections {
		if _, err := db.sql.ExecContext(ctx,
			`INSERT INTO collections (user_id, name, slug, kind, sort) VALUES (?, ?, ?, 'builtin', ?)
			 ON CONFLICT(user_id, slug) DO NOTHING`,
			userID, b.name, b.slug, i); err != nil {
			return err
		}
	}
	return nil
}

// ListCollections returns the user's collections with item counts, builtins
// first (in seed order) then user lists (by sort, then creation). When itemID >
// 0 each row also carries Contains - whether that item is a member - for the
// Save picker's checkmarks.
func (db *DB) ListCollections(ctx context.Context, userID, itemID int64) ([]Collection, error) {
	sel := `SELECT c.id, c.name, c.slug, c.kind, c.sort, c.created_at,
	        (SELECT COUNT(*) FROM collection_items ci WHERE ci.collection_id = c.id) AS item_count`
	var args []any
	if itemID > 0 {
		sel += `, (SELECT COUNT(*) FROM collection_items ci2 WHERE ci2.collection_id = c.id AND ci2.item_id = ?) AS contains`
		args = append(args, itemID)
	} else {
		sel += `, 0 AS contains`
	}
	args = append(args, userID)
	q := sel + `
	     FROM collections c WHERE c.user_id = ?
	     ORDER BY CASE c.kind WHEN 'builtin' THEN 0 ELSE 1 END, c.sort, c.created_at, c.id`

	rows, err := db.sql.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Collection
	for rows.Next() {
		var c Collection
		var created string
		var contains int
		if err := rows.Scan(&c.ID, &c.Name, &c.Slug, &c.Kind, &c.Sort, &created, &c.ItemCount, &contains); err != nil {
			return nil, err
		}
		c.CreatedAt = parseTime(created)
		if itemID > 0 {
			b := contains > 0
			c.Contains = &b
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// CreateCollection creates a user list. slug is the desired base; a numeric
// suffix is appended on collision so a create never fails on a duplicate name.
func (db *DB) CreateCollection(ctx context.Context, userID int64, name, slug string) (*Collection, error) {
	if slug == "" {
		slug = "list"
	}
	base := slug
	for i := 2; ; i++ {
		var n int
		if err := db.sql.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM collections WHERE user_id = ? AND slug = ?`, userID, slug).Scan(&n); err != nil {
			return nil, err
		}
		if n == 0 {
			break
		}
		slug = fmt.Sprintf("%s-%d", base, i)
	}
	res, err := db.sql.ExecContext(ctx,
		`INSERT INTO collections (user_id, name, slug, kind) VALUES (?, ?, ?, 'user')`,
		userID, name, slug)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return &Collection{ID: id, UserID: userID, Name: name, Slug: slug, Kind: CollectionKindUser}, nil
}

// RenameCollection renames a user list. Builtins are protected: the kind='user'
// guard makes a rename of a builtin a 0-row update, returning ErrCollectionProtected.
func (db *DB) RenameCollection(ctx context.Context, userID, id int64, name string) error {
	res, err := db.sql.ExecContext(ctx,
		`UPDATE collections SET name = ? WHERE id = ? AND user_id = ? AND kind = 'user'`,
		name, id, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrCollectionProtected
	}
	return nil
}

// DeleteCollection deletes a user list (and its memberships, via ON DELETE
// CASCADE). Builtins are refused via the kind='user' guard.
func (db *DB) DeleteCollection(ctx context.Context, userID, id int64) error {
	res, err := db.sql.ExecContext(ctx,
		`DELETE FROM collections WHERE id = ? AND user_id = ? AND kind = 'user'`, id, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrCollectionProtected
	}
	return nil
}

// CollectionItems returns a collection's items, newest-added first. Scoped to
// the owning user so one user can't browse another's list.
func (db *DB) CollectionItems(ctx context.Context, userID, collectionID int64) ([]Item, error) {
	rows, err := db.sql.QueryContext(ctx,
		`SELECT i.id, i.source_id, i.url, i.title, i.summary, i.content, i.author, i.thumbnail_url,
		        i.media_type, i.duration_sec, i.published_at, i.fetched_at
		 FROM collection_items ci
		 JOIN items i ON i.id = ci.item_id
		 JOIN collections c ON c.id = ci.collection_id
		 WHERE ci.collection_id = ? AND c.user_id = ?
		 ORDER BY ci.added_at DESC, ci.item_id DESC`, collectionID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanItems(rows)
}

// ownsCollection verifies a collection belongs to the user before a membership
// mutation, so an add/remove can't touch someone else's list.
func (db *DB) ownsCollection(ctx context.Context, userID, collectionID int64) error {
	var owner int64
	err := db.sql.QueryRowContext(ctx, `SELECT user_id FROM collections WHERE id = ?`, collectionID).Scan(&owner)
	if err == sql.ErrNoRows {
		return ErrCollectionProtected
	}
	if err != nil {
		return err
	}
	if owner != userID {
		return ErrCollectionProtected
	}
	return nil
}

// AddItemToCollection adds an item to a collection (idempotent). Verifies
// ownership first.
func (db *DB) AddItemToCollection(ctx context.Context, userID, collectionID, itemID int64) error {
	if err := db.ownsCollection(ctx, userID, collectionID); err != nil {
		return err
	}
	_, err := db.sql.ExecContext(ctx,
		`INSERT OR IGNORE INTO collection_items (collection_id, item_id) VALUES (?, ?)`, collectionID, itemID)
	return err
}

// RemoveItemFromCollection removes an item from a collection. Verifies ownership.
func (db *DB) RemoveItemFromCollection(ctx context.Context, userID, collectionID, itemID int64) error {
	if err := db.ownsCollection(ctx, userID, collectionID); err != nil {
		return err
	}
	_, err := db.sql.ExecContext(ctx,
		`DELETE FROM collection_items WHERE collection_id = ? AND item_id = ?`, collectionID, itemID)
	return err
}

// builtinCollectionID returns the id of a user's builtin collection by slug,
// seeding the builtins first so it exists. Used to wire the Like button to the
// Liked collection.
func (db *DB) builtinCollectionID(ctx context.Context, userID int64, slug string) (int64, error) {
	if err := db.EnsureBuiltinCollections(ctx, userID); err != nil {
		return 0, err
	}
	var id int64
	err := db.sql.QueryRowContext(ctx,
		`SELECT id FROM collections WHERE user_id = ? AND slug = ?`, userID, slug).Scan(&id)
	return id, err
}

// AddItemToBuiltinCollection adds an item to a builtin (by slug), seeding the
// builtins if absent. This is the Like -> Liked wiring: membership only, no
// engagement event and no item_state change, so the ranker's like/skip signal
// is untouched.
func (db *DB) AddItemToBuiltinCollection(ctx context.Context, userID int64, slug string, itemID int64) error {
	id, err := db.builtinCollectionID(ctx, userID, slug)
	if err != nil {
		return err
	}
	_, err = db.sql.ExecContext(ctx,
		`INSERT OR IGNORE INTO collection_items (collection_id, item_id) VALUES (?, ?)`, id, itemID)
	return err
}

// RemoveItemFromBuiltinCollection removes an item from a builtin (by slug). The
// un-like path: removes Liked membership without touching item_state.
func (db *DB) RemoveItemFromBuiltinCollection(ctx context.Context, userID int64, slug string, itemID int64) error {
	id, err := db.builtinCollectionID(ctx, userID, slug)
	if err != nil {
		return err
	}
	_, err = db.sql.ExecContext(ctx,
		`DELETE FROM collection_items WHERE collection_id = ? AND item_id = ?`, id, itemID)
	return err
}
