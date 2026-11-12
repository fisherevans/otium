package store

import (
	"context"
	"database/sql"
	"strconv"
	"time"
)

// Suggestion is a recommended source (#202) and where it stands.
type Suggestion struct {
	ID         int64     `json:"id"`
	Kind       string    `json:"kind"`
	FeedURL    string    `json:"feed_url"`
	Title      string    `json:"title"`
	IconURL    string    `json:"icon_url"`
	HomeURL    string    `json:"home_url"`
	Reason     string    `json:"reason"`
	Confidence float64   `json:"confidence"`
	Seed       string    `json:"seed"`
	TopicSlug  string    `json:"topic_slug"`
	Status     string    `json:"status"`
	SourceID   int64     `json:"source_id,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
	// For trials: how the trial is going.
	Shown  int `json:"shown,omitempty"`
	Opened int `json:"opened,omitempty"`
}

// KnownFeed reports whether a feed is already a source or was ever suggested, so
// the recommender never re-offers something followed or dismissed.
func (db *DB) KnownFeed(ctx context.Context, userID int64, feedURL string) (bool, error) {
	var n int
	err := db.sql.QueryRowContext(ctx,
		`SELECT (SELECT COUNT(*) FROM sources WHERE user_id = ? AND feed_url = ?) +
		        (SELECT COUNT(*) FROM suggestions WHERE user_id = ? AND feed_url = ?)`,
		userID, feedURL, userID, feedURL).Scan(&n)
	return n > 0, err
}

func (db *DB) InsertSuggestion(ctx context.Context, userID int64, s *Suggestion) (int64, error) {
	res, err := db.sql.ExecContext(ctx,
		`INSERT INTO suggestions (user_id, kind, feed_url, title, icon_url, home_url, reason, confidence, seed, topic_slug, status)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
		userID, s.Kind, s.FeedURL, s.Title, s.IconURL, s.HomeURL, s.Reason, s.Confidence, s.Seed, s.TopicSlug)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (db *DB) SetSuggestionStatus(ctx context.Context, userID, id int64, status string, sourceID *int64) error {
	q := `UPDATE suggestions SET status = ?, updated_at = datetime('now')`
	args := []any{status}
	if sourceID != nil {
		q += `, source_id = ?`
		args = append(args, *sourceID)
	}
	q += ` WHERE id = ? AND user_id = ?`
	_, err := db.sql.ExecContext(ctx, q, append(args, id, userID)...)
	return err
}

// ListSuggestions returns suggestions in the given statuses, most confident
// first, with trial progress for ones being tried.
func (db *DB) ListSuggestions(ctx context.Context, userID int64, statuses ...string) ([]Suggestion, error) {
	q := `SELECT g.id, g.kind, g.feed_url, g.title, g.icon_url, g.home_url, g.reason, g.confidence, g.seed, g.topic_slug,
	             g.status, COALESCE(g.source_id, 0), g.created_at,
	             COALESCE((SELECT COUNT(*) FROM item_state st JOIN items i ON i.id = st.item_id
	                       WHERE i.source_id = g.source_id AND st.user_id = g.user_id), 0),
	             COALESCE((SELECT COUNT(*) FROM item_state st JOIN items i ON i.id = st.item_id
	                       WHERE i.source_id = g.source_id AND st.user_id = g.user_id AND st.state IN ('opened','liked','saved')), 0)
	      FROM suggestions g WHERE g.user_id = ?`
	args := []any{userID}
	if len(statuses) > 0 {
		q += ` AND g.status IN (` + placeholders(len(statuses)) + `)`
		for _, s := range statuses {
			args = append(args, s)
		}
	}
	q += ` ORDER BY g.confidence DESC, g.id`
	rows, err := db.sql.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Suggestion{}
	for rows.Next() {
		var s Suggestion
		var created string
		if err := rows.Scan(&s.ID, &s.Kind, &s.FeedURL, &s.Title, &s.IconURL, &s.HomeURL, &s.Reason, &s.Confidence,
			&s.Seed, &s.TopicSlug, &s.Status, &s.SourceID, &created, &s.Shown, &s.Opened); err != nil {
			return nil, err
		}
		s.CreatedAt = parseTime(created)
		out = append(out, s)
	}
	return out, rows.Err()
}

func (db *DB) GetSuggestion(ctx context.Context, userID, id int64) (*Suggestion, error) {
	all, err := db.ListSuggestions(ctx, userID)
	if err != nil {
		return nil, err
	}
	for i := range all {
		if all[i].ID == id {
			return &all[i], nil
		}
	}
	return nil, nil
}

// SetSourceState moves a source through suggested -> trial -> followed -> archived.
func (db *DB) SetSourceState(ctx context.Context, userID, sourceID int64, state string) error {
	_, err := db.sql.ExecContext(ctx, `UPDATE sources SET state = ? WHERE id = ? AND user_id = ?`, state, sourceID, userID)
	return err
}

// FollowSource makes a source a followed one, the way Keep does for a trial
// (#216): the source and any suggestion that created it both become
// "followed". It reports whether the user has that source.
func (db *DB) FollowSource(ctx context.Context, userID, sourceID int64) (bool, error) {
	tx, err := db.sql.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, `UPDATE sources SET state = 'followed' WHERE id = ? AND user_id = ?`, sourceID, userID)
	if err != nil {
		return false, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return false, nil
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE suggestions SET status = 'followed', updated_at = datetime('now') WHERE source_id = ? AND user_id = ?`,
		sourceID, userID); err != nil {
		return false, err
	}
	return true, tx.Commit()
}

// SourceEngagement is one source's engagement summary, the recommender's input.
type SourceEngagement struct {
	SourceID int64   `json:"source_id"`
	Title    string  `json:"title"`
	Kind     string  `json:"kind"`
	FeedURL  string  `json:"feed_url"`
	HomeURL  string  `json:"home_url"`
	Topic    string  `json:"topic"`
	Section  string  `json:"section"`
	State    string  `json:"state"`
	Shown    int     `json:"shown"`
	Opened   int     `json:"opened"`
	Skipped  int     `json:"skipped"`
	Engaged  int     `json:"engaged"`
	Minutes  float64 `json:"minutes"`
}

// EngagementBySource summarises the event log per followed or trial source:
// dwell views, opens, skips, engaged dwells and minutes on screen.
func (db *DB) EngagementBySource(ctx context.Context, userID int64, sinceDays int) ([]SourceEngagement, error) {
	rows, err := db.sql.QueryContext(ctx, `
		WITH ev AS (
		  SELECT i.source_id sid, e.type,
		         CASE WHEN json_valid(e.detail) THEN e.detail ELSE '{}' END detail
		  FROM events e JOIN items i ON i.id = e.item_id
		  WHERE e.user_id = ? AND e.at >= datetime('now', ?))
		SELECT s.id, s.title, s.kind, s.feed_url, s.homepage_url, COALESCE(t.name, ''), COALESCE(sec.name, ''), s.state,
		       COALESCE(SUM(ev.type = 'dwell'), 0), COALESCE(SUM(ev.type = 'open'), 0), COALESCE(SUM(ev.type = 'skip'), 0),
		       COALESCE(SUM(ev.type = 'dwell' AND json_extract(ev.detail, '$.engaged') = 1), 0),
		       COALESCE(SUM(CASE WHEN ev.type = 'dwell' THEN COALESCE(json_extract(ev.detail, '$.ms'), 0) END), 0) / 60000.0
		FROM sources s
		LEFT JOIN topics t ON t.id = s.topic_id
		LEFT JOIN sections sec ON sec.id = t.section_id
		LEFT JOIN ev ON ev.sid = s.id
		WHERE s.user_id = ? AND s.state IN ('followed', 'trial')
		GROUP BY s.id`, userID, "-"+strconv.Itoa(sinceDays)+" days", userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SourceEngagement{}
	for rows.Next() {
		var e SourceEngagement
		var mins sql.NullFloat64
		if err := rows.Scan(&e.SourceID, &e.Title, &e.Kind, &e.FeedURL, &e.HomeURL, &e.Topic, &e.Section, &e.State,
			&e.Shown, &e.Opened, &e.Skipped, &e.Engaged, &mins); err != nil {
			return nil, err
		}
		e.Minutes = mins.Float64
		out = append(out, e)
	}
	return out, rows.Err()
}
