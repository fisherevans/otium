package store

import "context"

// ReadingStats is the descriptive, non-performance "how you read" summary (#135):
// aggregated from the append-only events log (read/open) + the sessions table. All
// counts are honest - external opens ("Open source" -> new tab) are counted as
// engagements but carry no measured duration, so they're excluded from the
// reading-time figures and reported separately. Never re-ranks anything.
type ReadingStats struct {
	Sessions      int         `json:"sessions"`        // sessions started
	AvgSessionMin float64     `json:"avg_session_min"` // avg length you set
	ReadMinInApp  int         `json:"read_min_in_app"` // total in-app active read/watch minutes
	ReadsInApp    int         `json:"reads_in_app"`    // articles/videos read/watched in-app
	ReadsExternal int         `json:"reads_external"`  // opened on the original site (duration unmeasured)
	AvgReadSec    int         `json:"avg_read_sec"`    // avg in-app read time per item, seconds
	ByTopic       []TopicTime `json:"by_topic"`        // time spent per topic (in-app), top-N
}

// TopicTime is a topic and the in-app minutes spent reading its items.
type TopicTime struct {
	Name string `json:"name"`
	Min  int    `json:"min"`
}

// ReadingStats aggregates the user's reading history. Safe on an empty history
// (returns zeroes). The read-event detail is a JSON blob {ms,external,kind}; JSON1's
// json_extract pulls the fields out at query time.
func (db *DB) ReadingStats(ctx context.Context, userID int64) (ReadingStats, error) {
	var rs ReadingStats

	if err := db.sql.QueryRowContext(ctx,
		`SELECT COUNT(*), COALESCE(AVG(duration_min), 0) FROM sessions WHERE user_id = ?`, userID).
		Scan(&rs.Sessions, &rs.AvgSessionMin); err != nil {
		return rs, err
	}

	var totalMs, inApp, external int64
	if err := db.sql.QueryRowContext(ctx,
		`SELECT
		   COALESCE(SUM(CASE WHEN json_extract(detail,'$.external') = 0 THEN CAST(json_extract(detail,'$.ms') AS INTEGER) ELSE 0 END), 0),
		   COALESCE(SUM(CASE WHEN json_extract(detail,'$.external') = 0 THEN 1 ELSE 0 END), 0),
		   COALESCE(SUM(CASE WHEN json_extract(detail,'$.external') = 1 THEN 1 ELSE 0 END), 0)
		 FROM events WHERE user_id = ? AND type = 'read'`, userID).
		Scan(&totalMs, &inApp, &external); err != nil {
		return rs, err
	}
	rs.ReadMinInApp = int(totalMs / 60000)
	rs.ReadsInApp = int(inApp)
	rs.ReadsExternal = int(external)
	if inApp > 0 {
		rs.AvgReadSec = int(totalMs / inApp / 1000)
	}

	rows, err := db.sql.QueryContext(ctx,
		`SELECT t.name, SUM(CAST(json_extract(e.detail,'$.ms') AS INTEGER)) AS ms
		 FROM events e
		 JOIN items i ON i.id = e.item_id
		 JOIN sources s ON s.id = i.source_id
		 JOIN topics t ON t.id = s.topic_id
		 WHERE e.user_id = ? AND e.type = 'read' AND json_extract(e.detail,'$.external') = 0
		 GROUP BY t.id ORDER BY ms DESC LIMIT 6`, userID)
	if err != nil {
		return rs, err
	}
	defer rows.Close()
	rs.ByTopic = []TopicTime{}
	for rows.Next() {
		var name string
		var ms int64
		if err := rows.Scan(&name, &ms); err != nil {
			return rs, err
		}
		if ms <= 0 {
			continue
		}
		rs.ByTopic = append(rs.ByTopic, TopicTime{Name: name, Min: int(ms / 60000)})
	}
	return rs, rows.Err()
}
