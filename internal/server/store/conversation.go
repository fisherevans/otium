package store

import (
	"context"
	"database/sql"
)

// ConversationTarget is what the conversation fetch (#200) needs to know about
// an item: where it lives on its platform and what kind of source it came from.
type ConversationTarget struct {
	ItemID     int64
	URL        string
	ExternalID string
	SourceKind string
	FeedURL    string
}

// GetConversationTarget returns the item's target scoped to the owning user, or
// (nil, nil) when it doesn't exist or isn't theirs.
func (db *DB) GetConversationTarget(ctx context.Context, userID, id int64) (*ConversationTarget, error) {
	var t ConversationTarget
	err := db.sql.QueryRowContext(ctx,
		`SELECT i.id, i.url, i.external_id, s.kind, s.feed_url
		 FROM items i JOIN sources s ON s.id = i.source_id
		 WHERE i.id = ? AND s.user_id = ?`, id, userID).
		Scan(&t.ItemID, &t.URL, &t.ExternalID, &t.SourceKind, &t.FeedURL)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}
