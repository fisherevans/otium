package store

import (
	"context"
	"database/sql"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Share target kinds and statuses (#195).
const (
	ShareKindFriend  = "friend"
	ShareKindChannel = "channel"

	ShareStatusPending   = "pending"
	ShareStatusConnected = "connected"
	ShareStatusFailing   = "failing"
)

// ShareTarget is a Discord friend or channel the owner shares to. ConnectToken is
// never serialised; the handler builds the connect link from it.
type ShareTarget struct {
	ID               int64     `json:"id"`
	Kind             string    `json:"kind"`
	Nickname         string    `json:"nickname"`
	DiscordUserID    string    `json:"discord_user_id,omitempty"`
	DiscordName      string    `json:"discord_name,omitempty"`
	GuildID          string    `json:"guild_id,omitempty"`
	GuildName        string    `json:"guild_name,omitempty"`
	ChannelID        string    `json:"-"`
	ChannelName      string    `json:"channel_name,omitempty"`
	ConnectToken     string    `json:"-"`
	ConnectExpiresAt time.Time `json:"-"`
	Status           string    `json:"status"`
	LastError        string    `json:"last_error,omitempty"`
	CreatedAt        time.Time `json:"created_at"`
	ConnectedAt      time.Time `json:"connected_at,omitzero"`
	LastSharedAt     time.Time `json:"last_shared_at,omitzero"`
	ShareCount       int       `json:"share_count"`
}

const shareTargetCols = `t.id, t.kind, t.nickname, t.discord_user_id, t.discord_name, t.guild_id, t.guild_name,
	t.channel_id, t.channel_name, t.connect_token, t.connect_expires_at, t.status, t.last_error,
	t.created_at, t.connected_at,
	(SELECT MAX(d.sent_at) FROM share_deliveries d WHERE d.target_id = t.id AND d.error = ''),
	(SELECT COUNT(*) FROM share_deliveries d WHERE d.target_id = t.id AND d.error = '')`

func scanShareTarget(r rowScanner) (*ShareTarget, error) {
	var t ShareTarget
	var expires, created, connected string
	var last sql.NullString
	if err := r.Scan(&t.ID, &t.Kind, &t.Nickname, &t.DiscordUserID, &t.DiscordName, &t.GuildID, &t.GuildName,
		&t.ChannelID, &t.ChannelName, &t.ConnectToken, &expires, &t.Status, &t.LastError,
		&created, &connected, &last, &t.ShareCount); err != nil {
		return nil, err
	}
	t.ConnectExpiresAt = parseTime(expires)
	t.CreatedAt = parseTime(created)
	t.ConnectedAt = parseTime(connected)
	t.LastSharedAt = parseTime(last.String)
	return &t, nil
}

// ListShareTargets returns the owner's friends and channels, most recently
// shared-to first, then by nickname.
func (db *DB) ListShareTargets(ctx context.Context, userID int64) ([]ShareTarget, error) {
	rows, err := db.sql.QueryContext(ctx, `SELECT `+shareTargetCols+` FROM share_targets t WHERE t.user_id = ?`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ShareTarget{}
	for rows.Next() {
		t, err := scanShareTarget(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *t)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if !out[i].LastSharedAt.Equal(out[j].LastSharedAt) {
			return out[i].LastSharedAt.After(out[j].LastSharedAt)
		}
		return strings.ToLower(out[i].Nickname) < strings.ToLower(out[j].Nickname)
	})
	return out, rows.Err()
}

func (db *DB) GetShareTarget(ctx context.Context, userID, id int64) (*ShareTarget, error) {
	t, err := scanShareTarget(db.sql.QueryRowContext(ctx,
		`SELECT `+shareTargetCols+` FROM share_targets t WHERE t.id = ? AND t.user_id = ?`, id, userID))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return t, err
}

// ShareTargetByToken finds the pending friend a connect link belongs to. Expired
// or already-used tokens return nil.
func (db *DB) ShareTargetByToken(ctx context.Context, token string) (*ShareTarget, int64, error) {
	if token == "" {
		return nil, 0, nil
	}
	var userID int64
	row := db.sql.QueryRowContext(ctx,
		`SELECT t.user_id, `+shareTargetCols+` FROM share_targets t WHERE t.connect_token = ? AND t.kind = 'friend'`, token)
	var t ShareTarget
	var expires, created, connected string
	var last sql.NullString
	err := row.Scan(&userID, &t.ID, &t.Kind, &t.Nickname, &t.DiscordUserID, &t.DiscordName, &t.GuildID, &t.GuildName,
		&t.ChannelID, &t.ChannelName, &t.ConnectToken, &expires, &t.Status, &t.LastError,
		&created, &connected, &last, &t.ShareCount)
	if err == sql.ErrNoRows {
		return nil, 0, nil
	}
	if err != nil {
		return nil, 0, err
	}
	t.ConnectExpiresAt = parseTime(expires)
	if time.Now().After(t.ConnectExpiresAt) {
		return nil, 0, nil
	}
	return &t, userID, nil
}

// CreateShareFriend adds a pending friend with a fresh connect token.
func (db *DB) CreateShareFriend(ctx context.Context, userID int64, nickname, token string, expires time.Time) (*ShareTarget, error) {
	res, err := db.sql.ExecContext(ctx,
		`INSERT INTO share_targets (user_id, kind, nickname, connect_token, connect_expires_at, status)
		 VALUES (?, 'friend', ?, ?, ?, 'pending')`,
		userID, nickname, token, expires.UTC().Format(time.RFC3339))
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return db.GetShareTarget(ctx, userID, id)
}

// SetShareConnectToken mints a new connect link for an existing friend (a lost
// link, or reconnecting someone who changed accounts).
func (db *DB) SetShareConnectToken(ctx context.Context, userID, id int64, token string, expires time.Time) error {
	_, err := db.sql.ExecContext(ctx,
		`UPDATE share_targets SET connect_token = ?, connect_expires_at = ? WHERE id = ? AND user_id = ? AND kind = 'friend'`,
		token, expires.UTC().Format(time.RFC3339), id, userID)
	return err
}

// ConnectShareFriend records who approved a connect link and burns the token.
func (db *DB) ConnectShareFriend(ctx context.Context, id int64, discordUserID, discordName string) error {
	_, err := db.sql.ExecContext(ctx,
		`UPDATE share_targets SET discord_user_id = ?, discord_name = ?, status = 'connected', last_error = '',
		        channel_id = CASE WHEN discord_user_id = ? THEN channel_id ELSE '' END,
		        connect_token = '', connect_expires_at = '', connected_at = datetime('now')
		 WHERE id = ? AND kind = 'friend'`, discordUserID, discordName, discordUserID, id)
	return err
}

// CreateShareChannel adds a server channel target.
func (db *DB) CreateShareChannel(ctx context.Context, userID int64, nickname, guildID, guildName, channelID, channelName string) (*ShareTarget, error) {
	res, err := db.sql.ExecContext(ctx,
		`INSERT INTO share_targets (user_id, kind, nickname, guild_id, guild_name, channel_id, channel_name, status, connected_at)
		 VALUES (?, 'channel', ?, ?, ?, ?, ?, 'connected', datetime('now'))`,
		userID, nickname, guildID, guildName, channelID, channelName)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return db.GetShareTarget(ctx, userID, id)
}

func (db *DB) RenameShareTarget(ctx context.Context, userID, id int64, nickname string) error {
	_, err := db.sql.ExecContext(ctx, `UPDATE share_targets SET nickname = ? WHERE id = ? AND user_id = ?`, nickname, id, userID)
	return err
}

func (db *DB) DeleteShareTarget(ctx context.Context, userID, id int64) error {
	_, err := db.sql.ExecContext(ctx, `DELETE FROM share_targets WHERE id = ? AND user_id = ?`, id, userID)
	return err
}

// SetShareTargetDM caches a friend's DM channel id once the bot has opened it.
func (db *DB) SetShareTargetDM(ctx context.Context, id int64, channelID string) error {
	_, err := db.sql.ExecContext(ctx, `UPDATE share_targets SET channel_id = ? WHERE id = ?`, channelID, id)
	return err
}

// SetShareTargetHealth records the outcome of the latest send: an empty error
// marks it connected again, anything else marks it failing.
func (db *DB) SetShareTargetHealth(ctx context.Context, id int64, sendErr string) error {
	status := ShareStatusConnected
	if sendErr != "" {
		status = ShareStatusFailing
	}
	_, err := db.sql.ExecContext(ctx,
		`UPDATE share_targets SET status = ?, last_error = ? WHERE id = ? AND status != 'pending'`, status, sendErr, id)
	return err
}

// Share is one item sent to one or more targets.
type Share struct {
	ID           int64           `json:"id"`
	ItemID       int64           `json:"item_id,omitempty"`
	URL          string          `json:"url"`
	Title        string          `json:"title"`
	SourceName   string          `json:"source_name"`
	ThumbnailURL string          `json:"thumbnail_url"`
	MediaType    string          `json:"media_type"`
	Note         string          `json:"note"`
	StreamKey    string          `json:"-"`
	CreatedAt    time.Time       `json:"created_at"`
	Deliveries   []ShareDelivery `json:"deliveries"`
}

type ShareDelivery struct {
	TargetID int64     `json:"target_id"`
	Nickname string    `json:"nickname"`
	Kind     string    `json:"kind"`
	Error    string    `json:"error,omitempty"`
	SentAt   time.Time `json:"sent_at"`
}

// StreamKey is the canonical recipient set for a share: the friend target ids,
// sorted. Channels are not part of it; a channel post is not a conversation.
func StreamKey(friendIDs []int64) string {
	ids := append([]int64(nil), friendIDs...)
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	parts := make([]string, len(ids))
	for i, id := range ids {
		parts[i] = strconv.FormatInt(id, 10)
	}
	return strings.Join(parts, ",")
}

// CreateShare stores the share before anything is sent, so a delivery always has
// a parent row.
func (db *DB) CreateShare(ctx context.Context, userID int64, s *Share) (int64, error) {
	var itemID any
	if s.ItemID != 0 {
		itemID = s.ItemID
	}
	res, err := db.sql.ExecContext(ctx,
		`INSERT INTO shares (user_id, item_id, url, title, source_name, thumbnail_url, media_type, note, stream_key)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		userID, itemID, s.URL, s.Title, s.SourceName, s.ThumbnailURL, s.MediaType, s.Note, s.StreamKey)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (db *DB) RecordShareDelivery(ctx context.Context, shareID, targetID int64, messageID, sendErr string) error {
	_, err := db.sql.ExecContext(ctx,
		`INSERT OR REPLACE INTO share_deliveries (share_id, target_id, discord_message_id, error) VALUES (?, ?, ?, ?)`,
		shareID, targetID, messageID, sendErr)
	return err
}

// ListShares is the owner's own sent log, newest first. targetID 0 means all.
func (db *DB) ListShares(ctx context.Context, userID, targetID int64, limit int) ([]Share, error) {
	q := `SELECT s.id, COALESCE(s.item_id, 0), s.url, s.title, s.source_name, s.thumbnail_url, s.media_type, s.note,
	             s.stream_key, s.created_at
	      FROM shares s WHERE s.user_id = ?`
	args := []any{userID}
	if targetID != 0 {
		q += ` AND EXISTS (SELECT 1 FROM share_deliveries d WHERE d.share_id = s.id AND d.target_id = ?)`
		args = append(args, targetID)
	}
	q += ` ORDER BY s.created_at DESC, s.id DESC LIMIT ?`
	args = append(args, limit)
	return db.queryShares(ctx, q, args...)
}

func (db *DB) queryShares(ctx context.Context, q string, args ...any) ([]Share, error) {
	rows, err := db.sql.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	out := []Share{}
	byID := map[int64]int{}
	for rows.Next() {
		var s Share
		var created string
		if err := rows.Scan(&s.ID, &s.ItemID, &s.URL, &s.Title, &s.SourceName, &s.ThumbnailURL, &s.MediaType,
			&s.Note, &s.StreamKey, &created); err != nil {
			rows.Close()
			return nil, err
		}
		s.CreatedAt = parseTime(created)
		s.Deliveries = []ShareDelivery{}
		byID[s.ID] = len(out)
		out = append(out, s)
	}
	rows.Close()
	if err := rows.Err(); err != nil || len(out) == 0 {
		return out, err
	}
	ids := make([]any, 0, len(out))
	for _, s := range out {
		ids = append(ids, s.ID)
	}
	drows, err := db.sql.QueryContext(ctx,
		`SELECT d.share_id, d.target_id, t.nickname, t.kind, d.error, d.sent_at
		 FROM share_deliveries d JOIN share_targets t ON t.id = d.target_id
		 WHERE d.share_id IN (`+placeholders(len(ids))+`) ORDER BY t.nickname`, ids...)
	if err != nil {
		return nil, err
	}
	defer drows.Close()
	for drows.Next() {
		var shareID int64
		var d ShareDelivery
		var sent string
		if err := drows.Scan(&shareID, &d.TargetID, &d.Nickname, &d.Kind, &d.Error, &sent); err != nil {
			return nil, err
		}
		d.SentAt = parseTime(sent)
		i := byID[shareID]
		out[i].Deliveries = append(out[i].Deliveries, d)
	}
	return out, drows.Err()
}

// FriendStream is one recipient set's worth of shares, as a friend sees it.
// Others are the other recipients' Discord display names, never the owner's
// private nicknames.
type FriendStream struct {
	Key    string
	Others []string
	Shares []Share
}

// FriendHistory is everything successfully shared with a Discord user, grouped
// into streams by recipient set, newest stream first.
func (db *DB) FriendHistory(ctx context.Context, discordUserID string, limit int) ([]FriendStream, error) {
	shares, err := db.queryShares(ctx,
		`SELECT s.id, COALESCE(s.item_id, 0), s.url, s.title, s.source_name, s.thumbnail_url, s.media_type, s.note,
		        s.stream_key, s.created_at
		 FROM shares s
		 WHERE EXISTS (SELECT 1 FROM share_deliveries d JOIN share_targets t ON t.id = d.target_id
		               WHERE d.share_id = s.id AND d.error = '' AND t.kind = 'friend' AND t.discord_user_id = ?)
		 ORDER BY s.created_at DESC, s.id DESC LIMIT ?`, discordUserID, limit)
	if err != nil {
		return nil, err
	}
	names := map[int64]string{}
	self := map[int64]bool{}
	rows, err := db.sql.QueryContext(ctx, `SELECT id, discord_name, discord_user_id FROM share_targets WHERE kind = 'friend'`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id int64
		var name, uid string
		if err := rows.Scan(&id, &name, &uid); err != nil {
			rows.Close()
			return nil, err
		}
		names[id] = name
		self[id] = uid == discordUserID
	}
	rows.Close()

	var streams []FriendStream
	idx := map[string]int{}
	for _, s := range shares {
		i, ok := idx[s.StreamKey]
		if !ok {
			fs := FriendStream{Key: s.StreamKey}
			for _, part := range strings.Split(s.StreamKey, ",") {
				id, _ := strconv.ParseInt(part, 10, 64)
				if id == 0 || self[id] {
					continue
				}
				if n := names[id]; n != "" {
					fs.Others = append(fs.Others, n)
				} else {
					fs.Others = append(fs.Others, "someone")
				}
			}
			idx[s.StreamKey] = len(streams)
			streams = append(streams, fs)
			i = len(streams) - 1
		}
		s.Deliveries = nil
		streams[i].Shares = append(streams[i].Shares, s)
	}
	return streams, nil
}

// IsShareFriend reports whether a Discord user is a connected friend of anyone,
// i.e. may see a history page.
func (db *DB) IsShareFriend(ctx context.Context, discordUserID string) (bool, error) {
	var n int
	err := db.sql.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM share_targets WHERE kind = 'friend' AND discord_user_id = ? AND status != 'pending'`,
		discordUserID).Scan(&n)
	return n > 0, err
}

// ShareSourceName is the display name of an item's source, for the share copy.
func (db *DB) ShareSourceName(ctx context.Context, sourceID int64) string {
	var name string
	_ = db.sql.QueryRowContext(ctx, `SELECT title FROM sources WHERE id = ?`, sourceID).Scan(&name)
	return name
}
