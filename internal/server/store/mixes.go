package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

// ErrMixNotFound is returned when a rename/delete/assign targets a mix the
// user doesn't own (or that doesn't exist). Handlers map it to 404/400.
var ErrMixNotFound = errors.New("mix not found")

// Mixes (#86) are a user-created overlay that gathers several FEEDS under one
// name, many-to-many. This file owns their CRUD, interest-assignment, and the
// mix->interests->sources expansion the session builder can target.

// ListMixes returns the user's mixes with their interest counts, ordered by sort
// then name.
func (db *DB) ListMixes(ctx context.Context, userID int64) ([]Mix, error) {
	rows, err := db.sql.QueryContext(ctx,
		`SELECT g.id, g.name, g.slug, g.icon, g.sort, g.created_at,
		        (SELECT COUNT(*) FROM mix_interests gf WHERE gf.mix_id = g.id) AS interest_count
		 FROM mixes g WHERE g.user_id = ? ORDER BY g.sort, g.name`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Mix
	for rows.Next() {
		var g Mix
		var created string
		if err := rows.Scan(&g.ID, &g.Name, &g.Slug, &g.Icon, &g.Sort, &created, &g.InterestCount); err != nil {
			return nil, err
		}
		g.CreatedAt = parseTime(created)
		out = append(out, g)
	}
	return out, rows.Err()
}

// CreateMix creates a mix. slug is the desired base; a numeric suffix is
// appended on collision so a create never fails on a duplicate name.
func (db *DB) CreateMix(ctx context.Context, userID int64, name, slug, icon string) (*Mix, error) {
	if slug == "" {
		slug = "mix"
	}
	base := slug
	for i := 2; ; i++ {
		var n int
		if err := db.sql.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM mixes WHERE user_id = ? AND slug = ?`, userID, slug).Scan(&n); err != nil {
			return nil, err
		}
		if n == 0 {
			break
		}
		slug = fmt.Sprintf("%s-%d", base, i)
	}
	res, err := db.sql.ExecContext(ctx,
		`INSERT INTO mixes (user_id, name, slug, icon) VALUES (?, ?, ?, ?)`,
		userID, name, slug, icon)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return &Mix{ID: id, UserID: userID, Name: name, Slug: slug, Icon: icon}, nil
}

// UpdateMix patches a mix's name/icon. Only non-nil fields are applied.
// Scoped to the user; a 0-row update means the mix isn't theirs.
func (db *DB) UpdateMix(ctx context.Context, userID, id int64, name, icon *string) error {
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
		`UPDATE mixes SET `+strings.Join(sets, ", ")+` WHERE id = ? AND user_id = ?`, args...)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrMixNotFound
	}
	return nil
}

// DeleteMix deletes a mix (and its memberships, via ON DELETE CASCADE).
// Scoped to the user.
func (db *DB) DeleteMix(ctx context.Context, userID, id int64) error {
	res, err := db.sql.ExecContext(ctx, `DELETE FROM mixes WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrMixNotFound
	}
	return nil
}

// SetMixInterests replaces the set of interests in a mix with exactly interestIDs.
// Unknown interest ids (or interests not owned by the user) are ignored. Scoped: a mix
// the user doesn't own returns ErrMixNotFound before any write.
func (db *DB) SetMixInterests(ctx context.Context, userID, mixID int64, interestIDs []int64) error {
	var owner int64
	err := db.sql.QueryRowContext(ctx, `SELECT user_id FROM mixes WHERE id = ?`, mixID).Scan(&owner)
	if err == sql.ErrNoRows || (err == nil && owner != userID) {
		return ErrMixNotFound
	}
	if err != nil {
		return err
	}
	tx, err := db.sql.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM mix_interests WHERE mix_id = ?`, mixID); err != nil {
		return err
	}
	for _, fid := range interestIDs {
		// The SELECT guard ensures the interest belongs to the user; a foreign interest id
		// inserts nothing.
		if _, err := tx.ExecContext(ctx,
			`INSERT OR IGNORE INTO mix_interests (mix_id, interest_id)
			 SELECT ?, id FROM interests WHERE id = ? AND user_id = ?`,
			mixID, fid, userID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// MixInterests returns the interests in a mix (full Interest rows with source counts),
// ordered like ListInterests. Scoped to the user.
func (db *DB) MixInterests(ctx context.Context, userID, mixID int64) ([]Interest, error) {
	rows, err := db.sql.QueryContext(ctx,
		`SELECT f.id, f.name, f.slug, f.color, f.icon, f.half_life_days, f.sort, f.created_at,
		        (SELECT COUNT(*) FROM sources s WHERE s.interest_id = f.id) AS source_count
		 FROM mix_interests gf JOIN interests f ON f.id = gf.interest_id
		 WHERE gf.mix_id = ? AND f.user_id = ?
		 ORDER BY f.sort, f.name`, mixID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Interest
	for rows.Next() {
		var f Interest
		var created string
		if err := rows.Scan(&f.ID, &f.Name, &f.Slug, &f.Color, &f.Icon, &f.HalfLifeDays, &f.Sort, &created, &f.SourceCount); err != nil {
			return nil, err
		}
		f.CreatedAt = parseTime(created)
		out = append(out, f)
	}
	return out, rows.Err()
}

// SourceIDsForMixes resolves mix slugs to the set of source ids across all
// their member interests (#86). The session builder uses this to let a mix filter a
// session (a mix = its interests = their sources).
func (db *DB) SourceIDsForMixes(ctx context.Context, userID int64, slugs []string) ([]int64, error) {
	if len(slugs) == 0 {
		return nil, nil
	}
	q := `SELECT DISTINCT s.id
	      FROM mixes g
	      JOIN mix_interests gf ON gf.mix_id = g.id
	      JOIN sources s ON s.interest_id = gf.interest_id
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
