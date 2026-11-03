package store

import (
	"context"
	"encoding/json"
)

// SessionPreset is one saved session setup (#203). Setup is opaque JSON here;
// the handler owns its shape and validation.
type SessionPreset struct {
	ID    string          `json:"id"`
	Name  string          `json:"name"`
	Setup json.RawMessage `json:"setup"`
}

const (
	kvPresetDefault     = "presets_default"
	kvPresetInitialized = "presets_initialized"
)

// ListPresets returns the saved presets in order, the default id, and whether
// presets were ever stored for this user (false = the browser should upload its
// local ones once).
func (db *DB) ListPresets(ctx context.Context, userID int64) ([]SessionPreset, string, bool, error) {
	rows, err := db.sql.QueryContext(ctx,
		`SELECT id, name, setup FROM session_presets WHERE user_id = ? ORDER BY sort, rowid`, userID)
	if err != nil {
		return nil, "", false, err
	}
	defer rows.Close()
	out := []SessionPreset{}
	for rows.Next() {
		var p SessionPreset
		var setup string
		if err := rows.Scan(&p.ID, &p.Name, &setup); err != nil {
			return nil, "", false, err
		}
		p.Setup = json.RawMessage(setup)
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, "", false, err
	}
	def, _, err := db.kvGet(ctx, userID, kvPresetDefault)
	if err != nil {
		return nil, "", false, err
	}
	_, init, err := db.kvGet(ctx, userID, kvPresetInitialized)
	return out, def, init, err
}

// ReplacePresets stores the full list in the given order (the browser's sync).
func (db *DB) ReplacePresets(ctx context.Context, userID int64, presets []SessionPreset, defaultID string) error {
	tx, err := db.sql.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM session_presets WHERE user_id = ?`, userID); err != nil {
		return err
	}
	for i, p := range presets {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO session_presets (user_id, id, name, setup, sort) VALUES (?, ?, ?, ?, ?)`,
			userID, p.ID, p.Name, string(p.Setup), i); err != nil {
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	if err := db.kvSet(ctx, userID, kvPresetDefault, defaultID); err != nil {
		return err
	}
	return db.kvSet(ctx, userID, kvPresetInitialized, "1")
}

// UpsertPreset creates or replaces one preset, appending new ones at the end. It
// does not mark the list initialized: a browser that has never synced still
// uploads its own presets, merged with what an agent added first.
func (db *DB) UpsertPreset(ctx context.Context, userID int64, p SessionPreset, makeDefault bool) error {
	if _, err := db.sql.ExecContext(ctx,
		`INSERT INTO session_presets (user_id, id, name, setup, sort)
		 VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort), -1) + 1 FROM session_presets WHERE user_id = ?))
		 ON CONFLICT(user_id, id) DO UPDATE SET name = excluded.name, setup = excluded.setup, updated_at = datetime('now')`,
		userID, p.ID, p.Name, string(p.Setup), userID); err != nil {
		return err
	}
	if makeDefault {
		return db.kvSet(ctx, userID, kvPresetDefault, p.ID)
	}
	return nil
}

func (db *DB) DeletePreset(ctx context.Context, userID int64, id string) (bool, error) {
	res, err := db.sql.ExecContext(ctx, `DELETE FROM session_presets WHERE user_id = ? AND id = ?`, userID, id)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}
