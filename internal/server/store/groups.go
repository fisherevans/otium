package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

// ErrGroupNotFound is returned when a rename/delete/assign targets a group the
// user doesn't own (or that doesn't exist). Handlers map it to 404/400.
var ErrGroupNotFound = errors.New("group not found")

// Groups (#86) are a user-created overlay that gathers several FEEDS under one
// name, many-to-many. This file owns their CRUD, feed-assignment, and the
// group->feeds->sources expansion the session builder can target.

// ListGroups returns the user's groups with their feed counts, ordered by sort
// then name.
func (db *DB) ListGroups(ctx context.Context, userID int64) ([]Group, error) {
	rows, err := db.sql.QueryContext(ctx,
		`SELECT g.id, g.name, g.slug, g.icon, g.sort, g.created_at,
		        (SELECT COUNT(*) FROM group_feeds gf WHERE gf.group_id = g.id) AS feed_count
		 FROM groups g WHERE g.user_id = ? ORDER BY g.sort, g.name`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Group
	for rows.Next() {
		var g Group
		var created string
		if err := rows.Scan(&g.ID, &g.Name, &g.Slug, &g.Icon, &g.Sort, &created, &g.FeedCount); err != nil {
			return nil, err
		}
		g.CreatedAt = parseTime(created)
		out = append(out, g)
	}
	return out, rows.Err()
}

// GetGroupBySlug returns a single group (without feed count), scoped to the user.
func (db *DB) GetGroupBySlug(ctx context.Context, userID int64, slug string) (*Group, error) {
	var g Group
	var created string
	err := db.sql.QueryRowContext(ctx,
		`SELECT id, name, slug, icon, sort, created_at FROM groups WHERE user_id = ? AND slug = ?`,
		userID, slug).Scan(&g.ID, &g.Name, &g.Slug, &g.Icon, &g.Sort, &created)
	if err == sql.ErrNoRows {
		return nil, ErrGroupNotFound
	}
	if err != nil {
		return nil, err
	}
	g.UserID = userID
	g.CreatedAt = parseTime(created)
	return &g, nil
}

// CreateGroup creates a group. slug is the desired base; a numeric suffix is
// appended on collision so a create never fails on a duplicate name.
func (db *DB) CreateGroup(ctx context.Context, userID int64, name, slug, icon string) (*Group, error) {
	if slug == "" {
		slug = "group"
	}
	base := slug
	for i := 2; ; i++ {
		var n int
		if err := db.sql.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM groups WHERE user_id = ? AND slug = ?`, userID, slug).Scan(&n); err != nil {
			return nil, err
		}
		if n == 0 {
			break
		}
		slug = fmt.Sprintf("%s-%d", base, i)
	}
	res, err := db.sql.ExecContext(ctx,
		`INSERT INTO groups (user_id, name, slug, icon) VALUES (?, ?, ?, ?)`,
		userID, name, slug, icon)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return &Group{ID: id, UserID: userID, Name: name, Slug: slug, Icon: icon}, nil
}

// UpdateGroup patches a group's name/icon. Only non-nil fields are applied.
// Scoped to the user; a 0-row update means the group isn't theirs.
func (db *DB) UpdateGroup(ctx context.Context, userID, id int64, name, icon *string) error {
	var sets []string
	var args []any
	if name != nil {
		sets = append(sets, "name = ?")
		args = append(args, *name)
	}
	if icon != nil {
		sets = append(sets, "icon = ?")
		args = append(args, *icon)
	}
	if len(sets) == 0 {
		return nil
	}
	args = append(args, id, userID)
	res, err := db.sql.ExecContext(ctx,
		`UPDATE groups SET `+strings.Join(sets, ", ")+` WHERE id = ? AND user_id = ?`, args...)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrGroupNotFound
	}
	return nil
}

// DeleteGroup deletes a group (and its memberships, via ON DELETE CASCADE).
// Scoped to the user.
func (db *DB) DeleteGroup(ctx context.Context, userID, id int64) error {
	res, err := db.sql.ExecContext(ctx, `DELETE FROM groups WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrGroupNotFound
	}
	return nil
}

// SetGroupFeeds replaces the set of feeds in a group with exactly feedIDs.
// Unknown feed ids (or feeds not owned by the user) are ignored. Scoped: a group
// the user doesn't own returns ErrGroupNotFound before any write.
func (db *DB) SetGroupFeeds(ctx context.Context, userID, groupID int64, feedIDs []int64) error {
	var owner int64
	err := db.sql.QueryRowContext(ctx, `SELECT user_id FROM groups WHERE id = ?`, groupID).Scan(&owner)
	if err == sql.ErrNoRows || (err == nil && owner != userID) {
		return ErrGroupNotFound
	}
	if err != nil {
		return err
	}
	tx, err := db.sql.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM group_feeds WHERE group_id = ?`, groupID); err != nil {
		return err
	}
	for _, fid := range feedIDs {
		// The SELECT guard ensures the feed belongs to the user; a foreign feed id
		// inserts nothing.
		if _, err := tx.ExecContext(ctx,
			`INSERT OR IGNORE INTO group_feeds (group_id, feed_id)
			 SELECT ?, id FROM feeds WHERE id = ? AND user_id = ?`,
			groupID, fid, userID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// GroupFeeds returns the feeds in a group (full Feed rows with source counts),
// ordered like ListFeeds. Scoped to the user.
func (db *DB) GroupFeeds(ctx context.Context, userID, groupID int64) ([]Feed, error) {
	rows, err := db.sql.QueryContext(ctx,
		`SELECT f.id, f.name, f.slug, f.color, f.icon, f.half_life_days, f.diversity, f.sort, f.created_at,
		        (SELECT COUNT(*) FROM sources s WHERE s.feed_id = f.id) AS source_count
		 FROM group_feeds gf JOIN feeds f ON f.id = gf.feed_id
		 WHERE gf.group_id = ? AND f.user_id = ?
		 ORDER BY f.sort, f.name`, groupID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Feed
	for rows.Next() {
		var f Feed
		var created string
		if err := rows.Scan(&f.ID, &f.Name, &f.Slug, &f.Color, &f.Icon, &f.HalfLifeDays, &f.Diversity, &f.Sort, &created, &f.SourceCount); err != nil {
			return nil, err
		}
		f.CreatedAt = parseTime(created)
		out = append(out, f)
	}
	return out, rows.Err()
}

// SourceIDsForGroups resolves group slugs to the set of source ids across all
// their member feeds (#86). The session builder uses this to let a group filter a
// session (a group = its feeds = their sources).
func (db *DB) SourceIDsForGroups(ctx context.Context, userID int64, slugs []string) ([]int64, error) {
	if len(slugs) == 0 {
		return nil, nil
	}
	q := `SELECT DISTINCT s.id
	      FROM groups g
	      JOIN group_feeds gf ON gf.group_id = g.id
	      JOIN sources s ON s.feed_id = gf.feed_id
	      WHERE g.user_id = ? AND g.slug IN (` + placeholders(len(slugs)) + `)`
	args := []any{userID}
	for _, s := range slugs {
		args = append(args, s)
	}
	rows, err := db.sql.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}
