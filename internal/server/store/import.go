package store

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// Durable per-source backlog import state (#122). The YouTube importer owns the
// fetch; this is the resumable queue + the archive-window resolution it needs.

// ImportJob is one due source import returned to the worker.
type ImportJob struct {
	SourceID  int64
	PageToken string
	Imported  int
	Attempts  int
}

// EnqueueImport queues (or re-queues, for a forced re-sync) a source backlog import,
// resetting it to pending from the start.
func (db *DB) EnqueueImport(ctx context.Context, sourceID int64) error {
	_, err := db.sql.ExecContext(ctx,
		`INSERT INTO source_import (source_id, status, page_token, attempts, next_attempt_at, last_error, updated_at)
		 VALUES (?, 'pending', '', 0, datetime('now'), '', datetime('now'))
		 ON CONFLICT(source_id) DO UPDATE SET
		   status='pending', page_token='', attempts=0, next_attempt_at=datetime('now'), last_error='', updated_at=datetime('now')`,
		sourceID)
	return err
}

// DueImports returns pending source imports whose backoff has elapsed as of now.
func (db *DB) DueImports(ctx context.Context, now time.Time, limit int) ([]ImportJob, error) {
	rows, err := db.sql.QueryContext(ctx,
		`SELECT source_id, page_token, imported, attempts FROM source_import
		 WHERE status='pending' AND next_attempt_at <= ?
		 ORDER BY next_attempt_at ASC LIMIT ?`, sqlTime(now), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ImportJob
	for rows.Next() {
		var j ImportJob
		if err := rows.Scan(&j.SourceID, &j.PageToken, &j.Imported, &j.Attempts); err != nil {
			return nil, err
		}
		out = append(out, j)
	}
	return out, rows.Err()
}

// AdvanceImport records progress after one imported page (still pending, next page).
func (db *DB) AdvanceImport(ctx context.Context, sourceID int64, pageToken string, addImported int) error {
	_, err := db.sql.ExecContext(ctx,
		`UPDATE source_import SET page_token=?, imported=imported+?, attempts=0, last_error='', next_attempt_at=datetime('now'), updated_at=datetime('now')
		 WHERE source_id=?`, pageToken, addImported, sourceID)
	return err
}

// CompleteImport marks an import finished (reached the end or the cutoff).
func (db *DB) CompleteImport(ctx context.Context, sourceID int64, addImported int) error {
	_, err := db.sql.ExecContext(ctx,
		`UPDATE source_import SET status='done', imported=imported+?, attempts=0, last_error='', updated_at=datetime('now')
		 WHERE source_id=?`, addImported, sourceID)
	return err
}

// RetryImport reschedules a transient failure with backoff.
func (db *DB) RetryImport(ctx context.Context, sourceID int64, next time.Time, errMsg string) error {
	_, err := db.sql.ExecContext(ctx,
		`UPDATE source_import SET attempts=attempts+1, next_attempt_at=?, last_error=?, updated_at=datetime('now')
		 WHERE source_id=?`, sqlTime(next), errMsg, sourceID)
	return err
}

// FailImport marks an import permanently failed.
func (db *DB) FailImport(ctx context.Context, sourceID int64, errMsg string) error {
	_, err := db.sql.ExecContext(ctx,
		`UPDATE source_import SET status='failed', attempts=attempts+1, last_error=?, updated_at=datetime('now')
		 WHERE source_id=?`, errMsg, sourceID)
	return err
}

// ImportStatus is the source_import row a UI/handler reads back ("" status = never
// imported).
type ImportStatus struct {
	Status   string `json:"status"`
	Imported int    `json:"imported"`
}

func (db *DB) ImportStatusFor(ctx context.Context, sourceID int64) (ImportStatus, error) {
	var s ImportStatus
	err := db.sql.QueryRowContext(ctx,
		`SELECT status, imported FROM source_import WHERE source_id=?`, sourceID).Scan(&s.Status, &s.Imported)
	if err == sql.ErrNoRows {
		return ImportStatus{}, nil
	}
	return s, err
}

// ResolvedArchiveDays resolves a source's effective Archive-After window (source >
// interest > global), matching session.resolveArchiveAfter: -1 = evergreen, N =
// days. Used to bound how far back a backlog import fetches.
func (db *DB) ResolvedArchiveDays(ctx context.Context, sourceID int64) (int, error) {
	var days int
	q := fmt.Sprintf(
		`SELECT CASE WHEN s.archive_after_days != 0 THEN s.archive_after_days
		             WHEN fi.archive_after_days != 0 THEN fi.archive_after_days
		             ELSE %d END
		 FROM sources s LEFT JOIN interests fi ON fi.id = s.interest_id WHERE s.id = ?`,
		GlobalArchiveAfterDays)
	err := db.sql.QueryRowContext(ctx, q, sourceID).Scan(&days)
	if err == sql.ErrNoRows {
		return GlobalArchiveAfterDays, nil
	}
	return days, err
}

// SourceByID loads a source (any user) for the import worker.
func (db *DB) SourceByID(ctx context.Context, id int64) (*Source, bool, error) {
	var s Source
	err := db.sql.QueryRowContext(ctx,
		`SELECT id, user_id, kind, title, feed_url FROM sources WHERE id = ?`, id).
		Scan(&s.ID, &s.UserID, &s.Kind, &s.Title, &s.FeedURL)
	if err == sql.ErrNoRows {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return &s, true, nil
}
