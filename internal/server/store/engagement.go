package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Engagement (#196): explicit like/dislike signals and per-view watch/read
// metrics, recorded so Fisher can look back over a month and see which channels
// he skips every time and which he likes. Descriptive only - the session engine
// never reads these tables, nothing acts on a single signal, and a dislike does
// not mute or unsubscribe anything.

// ItemContext is the snapshot stored with a signal or a view: what the item was
// about at the time, so a rollup by channel or tag survives the item being
// archived or its source being removed.
type ItemContext struct {
	SourceID    int64    `json:"source_id"`
	SourceTitle string   `json:"source_title"`
	MediaType   string   `json:"media_type"`
	Tags        []string `json:"tags,omitempty"`
	DurationSec int      `json:"duration_sec,omitempty"`
}

var hashtagRe = regexp.MustCompile(`(?:^|\s)#([\p{L}\p{N}_]{2,40})`)

// itemTags is an item's RSS categories plus any #hashtags in its title and
// summary (YouTube puts a Short's hashtags there), lower-cased and deduped.
func itemTags(categories, title, summary string) []string {
	seen := map[string]bool{}
	var out []string
	add := func(t string) {
		t = strings.ToLower(strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(t), "#")))
		if t == "" || seen[t] {
			return
		}
		seen[t] = true
		out = append(out, t)
	}
	for _, c := range strings.Split(categories, "\n") {
		add(c)
	}
	for _, m := range hashtagRe.FindAllStringSubmatch(title+"\n"+summary, -1) {
		add(m[1])
	}
	return out
}

// ErrItemNotFound is returned when the item is not in one of the user's sources.
var ErrItemNotFound = errors.New("item not found")

// ItemContextFor builds the snapshot for one of the user's items.
func (db *DB) ItemContextFor(ctx context.Context, userID, itemID int64) (ItemContext, error) {
	var c ItemContext
	var categories, title, summary string
	err := db.sql.QueryRowContext(ctx,
		`SELECT i.source_id, s.title, i.media_type, i.categories, i.title, i.summary, i.duration_sec
		 FROM items i JOIN sources s ON s.id = i.source_id
		 WHERE i.id = ? AND s.user_id = ?`, itemID, userID).
		Scan(&c.SourceID, &c.SourceTitle, &c.MediaType, &categories, &title, &summary, &c.DurationSec)
	if errors.Is(err, sql.ErrNoRows) {
		return c, ErrItemNotFound
	}
	if err != nil {
		return c, err
	}
	c.Tags = itemTags(categories, title, summary)
	return c, nil
}

// SetItemSignal sets the item's like/dislike ("" clears it) and appends the
// change to the events log. Like and dislike are mutually exclusive: setting one
// replaces the other. Returns the signal now in effect.
func (db *DB) SetItemSignal(ctx context.Context, userID, itemID int64, signal string) (string, error) {
	c, err := db.ItemContextFor(ctx, userID, itemID)
	if err != nil {
		return "", err
	}
	snap, _ := json.Marshal(c)
	tx, err := db.sql.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	var prev string
	err = tx.QueryRowContext(ctx, `SELECT signal FROM item_signals WHERE user_id = ? AND item_id = ?`, userID, itemID).Scan(&prev)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	if prev == signal {
		return signal, nil
	}
	if signal == "" {
		_, err = tx.ExecContext(ctx, `DELETE FROM item_signals WHERE user_id = ? AND item_id = ?`, userID, itemID)
	} else {
		_, err = tx.ExecContext(ctx,
			`INSERT INTO item_signals (user_id, item_id, signal, source_id, context, at)
			 VALUES (?, ?, ?, ?, ?, datetime('now'))
			 ON CONFLICT(user_id, item_id) DO UPDATE SET signal = excluded.signal,
			   source_id = excluded.source_id, context = excluded.context, at = excluded.at`,
			userID, itemID, signal, c.SourceID, string(snap))
	}
	if err != nil {
		return "", err
	}
	// The log reads as what happened: undoing the old signal, then the new one.
	logs := []string{}
	if prev != "" {
		logs = append(logs, "un"+prev)
	}
	if signal != "" {
		logs = append(logs, signal)
	}
	for _, typ := range logs {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO events (user_id, type, item_id, source_id, detail) VALUES (?, ?, ?, ?, ?)`,
			userID, typ, itemID, c.SourceID, string(snap)); err != nil {
			return "", err
		}
	}
	return signal, tx.Commit()
}

// ItemSignals returns the current signal for each of the given items that has one.
func (db *DB) ItemSignals(ctx context.Context, userID int64, itemIDs []int64) (map[int64]string, error) {
	out := map[int64]string{}
	if len(itemIDs) == 0 {
		return out, nil
	}
	args := make([]any, 0, len(itemIDs)+1)
	args = append(args, userID)
	for _, id := range itemIDs {
		args = append(args, id)
	}
	rows, err := db.sql.QueryContext(ctx,
		`SELECT item_id, signal FROM item_signals WHERE user_id = ? AND item_id IN (?`+strings.Repeat(",?", len(itemIDs)-1)+`)`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var s string
		if err := rows.Scan(&id, &s); err != nil {
			return nil, err
		}
		out[id] = s
	}
	return out, rows.Err()
}

// ItemView is one time an item was on screen, as the client measured it.
type ItemView struct {
	ViewKey     string    `json:"view_key"`
	SessionID   string    `json:"session_id"`
	ShownAt     time.Time `json:"shown_at"`
	DwellMs     int64     `json:"dwell_ms"`
	Opened      bool      `json:"opened"`
	External    bool      `json:"external"`
	ActiveMs    int64     `json:"active_ms"`
	VideoLenSec float64   `json:"video_len_sec"`
	MaxPosSec   float64   `json:"max_pos_sec"`
	Plays       int       `json:"plays"`
	Pauses      int       `json:"pauses"`
	Seeks       int       `json:"seeks"`
	Resumed     bool      `json:"resumed"`
	Completed   bool      `json:"completed"`
	ScrollDepth float64   `json:"scroll_depth"`
}

// InstantSkipMs is the on-screen time under which a view that was not opened
// counts as an instant skip. Autoplay does not count as opening: a Short starts
// on its own, and flicking past it in half a second is still a skip.
const InstantSkipMs = 1000

// RecordItemView stores (or replaces, by view key) a view of one of the user's
// items with its context snapshot. A video length the player reported fills in
// the item's duration when ingest and enrichment never found one.
func (db *DB) RecordItemView(ctx context.Context, userID, itemID int64, v ItemView) error {
	c, err := db.ItemContextFor(ctx, userID, itemID)
	if err != nil {
		return err
	}
	if v.ShownAt.IsZero() {
		v.ShownAt = time.Now()
	}
	if v.ScrollDepth < 0 {
		v.ScrollDepth = 0
	} else if v.ScrollDepth > 1 {
		v.ScrollDepth = 1
	}
	if v.VideoLenSec > 0 && v.MaxPosSec >= v.VideoLenSec*0.95 {
		v.Completed = true
	}
	instant := v.DwellMs < InstantSkipMs && !v.Opened
	_, err = db.sql.ExecContext(ctx,
		`INSERT INTO item_views (user_id, view_key, item_id, session_id, source_id, source_title, media_type, tags,
		   shown_at, dwell_ms, opened, external, instant_skip, active_ms, video_len_sec, max_pos_sec,
		   plays, pauses, seeks, resumed, completed, scroll_depth)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(user_id, view_key) DO UPDATE SET
		   dwell_ms = excluded.dwell_ms, opened = excluded.opened, external = excluded.external,
		   instant_skip = excluded.instant_skip, active_ms = excluded.active_ms,
		   video_len_sec = excluded.video_len_sec, max_pos_sec = excluded.max_pos_sec,
		   plays = excluded.plays, pauses = excluded.pauses, seeks = excluded.seeks,
		   resumed = excluded.resumed, completed = excluded.completed,
		   scroll_depth = excluded.scroll_depth, updated_at = datetime('now')`,
		userID, v.ViewKey, itemID, v.SessionID, c.SourceID, c.SourceTitle, c.MediaType, strings.Join(c.Tags, "\n"),
		v.ShownAt.UTC().Format(time.DateTime), v.DwellMs, v.Opened, v.External, instant, v.ActiveMs,
		v.VideoLenSec, v.MaxPosSec, v.Plays, v.Pauses, v.Seeks, v.Resumed, v.Completed, v.ScrollDepth)
	if err != nil {
		return err
	}
	if c.DurationSec == 0 && v.VideoLenSec >= 1 {
		_, err = db.sql.ExecContext(ctx, `UPDATE items SET duration_sec = ? WHERE id = ? AND duration_sec = 0`,
			int(v.VideoLenSec+0.5), itemID)
	}
	return err
}

// EngagementRow is one channel's (or one tag's) engagement over a date range.
type EngagementRow struct {
	Key   string `json:"key"`   // source id or tag
	Label string `json:"label"` // source title or tag
	Kind  string `json:"kind,omitempty"`
	// Shown counts views; Opened views where the reader, an explicit play or the
	// original was opened; InstantSkips views gone in under a second untouched.
	Shown        int `json:"shown"`
	Opened       int `json:"opened"`
	InstantSkips int `json:"instant_skips"`
	// Videos counts video views; MedianWatch is the median fraction of each
	// video watched (furthest point / length), over views with a known length.
	Videos      int      `json:"videos"`
	MedianWatch *float64 `json:"median_watch,omitempty"`
	Completed   int      `json:"completed"`
	ActiveMin   float64  `json:"active_min"` // foreground read/watch time
	DwellMin    float64  `json:"dwell_min"`  // time on screen
	Likes       int      `json:"likes"`
	Dislikes    int      `json:"dislikes"`
	Shares      int      `json:"shares"`
	Saves       int      `json:"saves"`
}

// EngagementReport is the rollup for a range, by source or by tag.
type EngagementReport struct {
	From time.Time       `json:"from"`
	To   time.Time       `json:"to"`
	By   string          `json:"by"`
	Rows []EngagementRow `json:"rows"`
}

// Engagement rolls up views, signals, shares and saves in [from, to) by source
// ("source") or by tag ("tag"). Rows are ordered by how often they were shown.
func (db *DB) Engagement(ctx context.Context, userID int64, from, to time.Time, by string) (EngagementReport, error) {
	if by != "tag" {
		by = "source"
	}
	rep := EngagementReport{From: from, To: to, By: by, Rows: []EngagementRow{}}
	f, t := from.UTC().Format(time.DateTime), to.UTC().Format(time.DateTime)

	rows := map[string]*EngagementRow{}
	watch := map[string][]float64{}
	// keys maps a record to the rows it counts toward: its source, or each tag.
	keys := func(sourceID int64, title, tags string) []*EngagementRow {
		var out []*EngagementRow
		get := func(key, label string) *EngagementRow {
			r := rows[key]
			if r == nil {
				r = &EngagementRow{Key: key, Label: label}
				rows[key] = r
			}
			return r
		}
		if by == "source" {
			return append(out, get(strconv.FormatInt(sourceID, 10), title))
		}
		for _, tag := range strings.Split(tags, "\n") {
			if tag != "" {
				out = append(out, get(tag, "#"+tag))
			}
		}
		return out
	}

	vr, err := db.sql.QueryContext(ctx,
		`SELECT COALESCE(source_id, 0), source_title, media_type, tags, dwell_ms, opened, instant_skip, active_ms,
		        video_len_sec, max_pos_sec, completed
		 FROM item_views WHERE user_id = ? AND shown_at >= ? AND shown_at < ?`, userID, f, t)
	if err != nil {
		return rep, err
	}
	for vr.Next() {
		var sid, dwell, active int64
		var title, media, tags string
		var opened, instant, completed bool
		var length, maxPos float64
		if err := vr.Scan(&sid, &title, &media, &tags, &dwell, &opened, &instant, &active, &length, &maxPos, &completed); err != nil {
			vr.Close()
			return rep, err
		}
		video := media == "short" || media == "long" || media == "live"
		for _, r := range keys(sid, title, tags) {
			r.Shown++
			r.DwellMin += float64(dwell) / 60000
			r.ActiveMin += float64(active) / 60000
			if opened {
				r.Opened++
			}
			if instant {
				r.InstantSkips++
			}
			if video {
				r.Videos++
				if completed {
					r.Completed++
				}
				if length > 0 {
					watch[r.Key] = append(watch[r.Key], min(1, maxPos/length))
				}
			}
		}
	}
	vr.Close()
	if err := vr.Err(); err != nil {
		return rep, err
	}

	sr, err := db.sql.QueryContext(ctx,
		`SELECT signal, COALESCE(source_id, 0), context FROM item_signals WHERE user_id = ? AND at >= ? AND at < ?`, userID, f, t)
	if err != nil {
		return rep, err
	}
	for sr.Next() {
		var signal, snap string
		var sid int64
		if err := sr.Scan(&signal, &sid, &snap); err != nil {
			sr.Close()
			return rep, err
		}
		var c ItemContext
		_ = json.Unmarshal([]byte(snap), &c)
		for _, r := range keys(sid, c.SourceTitle, strings.Join(c.Tags, "\n")) {
			if signal == "like" {
				r.Likes++
			} else if signal == "dislike" {
				r.Dislikes++
			}
		}
	}
	sr.Close()
	if err := sr.Err(); err != nil {
		return rep, err
	}

	// Shares and saves only count for items still stored; their item carries the
	// source and tags.
	for _, q := range []struct {
		sql   string
		share bool
	}{
		{`SELECT i.source_id, s.title, i.categories, i.title, i.summary
		  FROM shares sh JOIN items i ON i.id = sh.item_id JOIN sources s ON s.id = i.source_id
		  WHERE sh.user_id = ? AND sh.created_at >= ? AND sh.created_at < ?`, true},
		{`SELECT i.source_id, s.title, i.categories, i.title, i.summary
		  FROM collection_items ci JOIN collections c ON c.id = ci.collection_id
		  JOIN items i ON i.id = ci.item_id JOIN sources s ON s.id = i.source_id
		  WHERE c.user_id = ? AND ci.added_at >= ? AND ci.added_at < ?`, false},
	} {
		qr, err := db.sql.QueryContext(ctx, q.sql, userID, f, t)
		if err != nil {
			return rep, err
		}
		for qr.Next() {
			var sid int64
			var title, cats, itemTitle, summary string
			if err := qr.Scan(&sid, &title, &cats, &itemTitle, &summary); err != nil {
				qr.Close()
				return rep, err
			}
			for _, r := range keys(sid, title, strings.Join(itemTags(cats, itemTitle, summary), "\n")) {
				if q.share {
					r.Shares++
				} else {
					r.Saves++
				}
			}
		}
		qr.Close()
		if err := qr.Err(); err != nil {
			return rep, err
		}
	}

	// Source rows carry the live title and kind when the source still exists.
	if by == "source" {
		sources, err := db.sql.QueryContext(ctx, `SELECT id, title, kind FROM sources WHERE user_id = ?`, userID)
		if err != nil {
			return rep, err
		}
		for sources.Next() {
			var id int64
			var title, kind string
			if err := sources.Scan(&id, &title, &kind); err != nil {
				sources.Close()
				return rep, err
			}
			if r := rows[strconv.FormatInt(id, 10)]; r != nil {
				r.Label, r.Kind = title, kind
			}
		}
		sources.Close()
	}

	for key, r := range rows {
		if w := watch[key]; len(w) > 0 {
			sort.Float64s(w)
			m := w[len(w)/2]
			if len(w)%2 == 0 {
				m = (w[len(w)/2-1] + w[len(w)/2]) / 2
			}
			r.MedianWatch = &m
		}
		r.DwellMin = round2(r.DwellMin)
		r.ActiveMin = round2(r.ActiveMin)
		rep.Rows = append(rep.Rows, *r)
	}
	sort.Slice(rep.Rows, func(i, j int) bool {
		a, b := rep.Rows[i], rep.Rows[j]
		if a.Shown != b.Shown {
			return a.Shown > b.Shown
		}
		return a.Label < b.Label
	})
	return rep, nil
}

func round2(f float64) float64 { return float64(int(f*100+0.5)) / 100 }
