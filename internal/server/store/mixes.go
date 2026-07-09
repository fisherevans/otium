package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

// ErrSectionNotFound is returned when a rename/delete/assign targets a section the
// user doesn't own (or that doesn't exist). Handlers map it to 404/400.
var ErrSectionNotFound = errors.New("section not found")

// Sections (#86) are a user-created overlay that gathers several FEEDS under one
// name, many-to-many. This file owns their CRUD, topic-assignment, and the
// section->topics->sources expansion the session builder can target.

// ListSections returns the user's sections with their topic counts, ordered by sort
// then name.
func (db *DB) ListSections(ctx context.Context, userID int64) ([]Section, error) {
	rows, err := db.sql.QueryContext(ctx,
		`SELECT g.id, g.name, g.slug, g.icon, g.sort, g.created_at,
		        (SELECT COUNT(*) FROM topics t WHERE t.section_id = g.id) AS topic_count
		 FROM sections g WHERE g.user_id = ? ORDER BY g.sort, g.name`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Section
	for rows.Next() {
		var g Section
		var created string
		if err := rows.Scan(&g.ID, &g.Name, &g.Slug, &g.Icon, &g.Sort, &created, &g.TopicCount); err != nil {
			return nil, err
		}
		g.CreatedAt = parseTime(created)
		out = append(out, g)
	}
	return out, rows.Err()
}

// CreateSection creates a section. slug is the desired base; a numeric suffix is
// appended on collision so a create never fails on a duplicate name.
func (db *DB) CreateSection(ctx context.Context, userID int64, name, slug, icon string) (*Section, error) {
	if slug == "" {
		slug = "section"
	}
	base := slug
	for i := 2; ; i++ {
		var n int
		if err := db.sql.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM sections WHERE user_id = ? AND slug = ?`, userID, slug).Scan(&n); err != nil {
			return nil, err
		}
		if n == 0 {
			break
		}
		slug = fmt.Sprintf("%s-%d", base, i)
	}
	res, err := db.sql.ExecContext(ctx,
		`INSERT INTO sections (user_id, name, slug, icon) VALUES (?, ?, ?, ?)`,
		userID, name, slug, icon)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return &Section{ID: id, UserID: userID, Name: name, Slug: slug, Icon: icon}, nil
}

// UpdateSection patches a section's name/icon. Only non-nil fields are applied.
// Scoped to the user; a 0-row update means the section isn't theirs.
func (db *DB) UpdateSection(ctx context.Context, userID, id int64, name, icon *string) error {
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
		`UPDATE sections SET `+strings.Join(sets, ", ")+` WHERE id = ? AND user_id = ?`, args...)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrSectionNotFound
	}
	return nil
}

// DeleteSection deletes a section, first reassigning its topics to the user's
// Uncategorized section so the strict tree keeps no orphans (#130). Deleting the
// Uncategorized section itself is a no-op guard is unnecessary - reassigning to
// itself then deleting would orphan; instead its topics move to a freshly ensured
// Uncategorized (recreated if this was it). Scoped to the user.
func (db *DB) DeleteSection(ctx context.Context, userID, id int64) error {
	var owner int64
	if err := db.sql.QueryRowContext(ctx, `SELECT user_id FROM sections WHERE id = ?`, id).Scan(&owner); err != nil {
		if err == sql.ErrNoRows {
			return ErrSectionNotFound
		}
		return err
	}
	if owner != userID {
		return ErrSectionNotFound
	}
	// Move this section's topics out first. Delete the section, then route any now
	// section-less topics of this user to Uncategorized (recreated if we just deleted
	// it), so a topic is never left orphaned.
	if _, err := db.sql.ExecContext(ctx, `DELETE FROM sections WHERE id = ? AND user_id = ?`, id, userID); err != nil {
		return err
	}
	unc, err := db.ensureUncategorizedSection(ctx, userID)
	if err != nil {
		return err
	}
	_, err = db.sql.ExecContext(ctx, `UPDATE topics SET section_id = ? WHERE user_id = ? AND section_id IS NULL`, unc, userID)
	return err
}

// SetSectionTopics assigns the given topics to a section (#130 strict tree). Since a
// topic belongs to exactly one section, this moves each listed topic into the section
// (it does not evict the section's other topics - that would orphan them). Unknown or
// foreign topic ids are ignored. Scoped: a section the user doesn't own returns
// ErrSectionNotFound before any write.
func (db *DB) SetSectionTopics(ctx context.Context, userID, sectionID int64, topicIDs []int64) error {
	var owner int64
	err := db.sql.QueryRowContext(ctx, `SELECT user_id FROM sections WHERE id = ?`, sectionID).Scan(&owner)
	if err == sql.ErrNoRows || (err == nil && owner != userID) {
		return ErrSectionNotFound
	}
	if err != nil {
		return err
	}
	for _, fid := range topicIDs {
		if _, err := db.sql.ExecContext(ctx,
			`UPDATE topics SET section_id = ? WHERE id = ? AND user_id = ?`, sectionID, fid, userID); err != nil {
			return err
		}
	}
	return nil
}

// MoveTopicToSection moves a single topic into a section (#130/#131 "Move"). Both
// must belong to the user. Returns ErrSectionNotFound if the topic isn't the user's.
func (db *DB) MoveTopicToSection(ctx context.Context, userID, topicID, sectionID int64) error {
	var owner int64
	if err := db.sql.QueryRowContext(ctx, `SELECT user_id FROM sections WHERE id = ?`, sectionID).Scan(&owner); err != nil {
		if err == sql.ErrNoRows {
			return ErrSectionNotFound
		}
		return err
	}
	if owner != userID {
		return ErrSectionNotFound
	}
	res, err := db.sql.ExecContext(ctx,
		`UPDATE topics SET section_id = ? WHERE id = ? AND user_id = ?`, sectionID, topicID, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrSectionNotFound
	}
	return nil
}

// SectionTopics returns the topics in a section (full Topic rows with source counts),
// ordered like ListTopics. Scoped to the user.
func (db *DB) SectionTopics(ctx context.Context, userID, sectionID int64) ([]Topic, error) {
	rows, err := db.sql.QueryContext(ctx,
		`SELECT f.id, f.name, f.slug, f.color, f.icon, f.half_life_days, f.sort, f.created_at,
		        (SELECT COUNT(*) FROM sources s WHERE s.topic_id = f.id) AS source_count
		 FROM topics f
		 WHERE f.section_id = ? AND f.user_id = ?
		 ORDER BY f.sort, f.name`, sectionID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Topic
	for rows.Next() {
		var f Topic
		var created string
		if err := rows.Scan(&f.ID, &f.Name, &f.Slug, &f.Color, &f.Icon, &f.HalfLifeDays, &f.Sort, &created, &f.SourceCount); err != nil {
			return nil, err
		}
		f.CreatedAt = parseTime(created)
		out = append(out, f)
	}
	return out, rows.Err()
}

// SourceIDsForSections resolves section slugs to the set of source ids across all
// their member topics (#86). The session builder uses this to let a section filter a
// session (a section = its topics = their sources).
func (db *DB) SourceIDsForSections(ctx context.Context, userID int64, slugs []string) ([]int64, error) {
	if len(slugs) == 0 {
		return nil, nil
	}
	q := `SELECT DISTINCT s.id
	      FROM sections g
	      JOIN topics f ON f.section_id = g.id
	      JOIN sources s ON s.topic_id = f.id
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
