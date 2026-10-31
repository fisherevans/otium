package store

import (
	"context"
	"fmt"
	"testing"
	"time"
)

func videoMetadataDB(t *testing.T) (*DB, *Source) {
	t.Helper()
	db, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	ctx := context.Background()
	u, err := db.UpsertUserByUsername(ctx, "videos", "")
	if err != nil {
		t.Fatal(err)
	}
	s, err := db.CreateSource(ctx, &Source{UserID: u.ID, Kind: "youtube", Title: "Videos", FeedURL: "http://videos", State: "followed", Weight: 1})
	if err != nil {
		t.Fatal(err)
	}
	return db, s
}

func TestVideoMetadataMerge(t *testing.T) {
	tests := []struct {
		name, kind, url, writer string
		seconds, incoming       int
		aspect, newAspect       float64
		want                    string
	}{
		{"duration uses known aspect", "long", "watch", "duration", 0, 95, 0.5625, 0, "short"},
		{"duration without aspect conservative", "long", "watch", "duration", 0, 95, 0, 0, "long"},
		{"duration preserves explicit", "short", "/shorts/x", "duration", 0, 180, 0, 0, "short"},
		{"duration preserves live", "live", "/shorts/x", "duration", 0, 30, 0, 0.5625, "live"},
		{"duration preserves unknown", "unknown", "watch", "duration", 0, 30, 0, 0.5625, "unknown"},
		{"duration preserves article", "article", "watch", "duration", 0, 30, 0, 0.5625, "article"},
		{"duration preserves audio", "audio", "watch", "duration", 0, 30, 0, 0.5625, "audio"},
		{"aspect backfill square", "long", "watch", "aspect", 180, 0, 0, 1, "short"},
		{"aspect backfill too long", "long", "watch", "aspect", 181, 0, 0, 0.5625, "long"},
		{"aspect missing duration", "long", "watch", "aspect", 0, 0, 0, 0.5625, "long"},
		{"API keeps known aspect", "long", "watch", "api", 0, 95, 0.5625, 0, "short"},
		{"API keeps known duration", "long", "watch", "api", 95, 0, 0, 0.5625, "short"},
		{"API keeps explicit URL", "short", "/shorts/x", "api", 0, 180, 0, 1.778, "short"},
		{"API keeps live", "live", "watch", "api", 0, 30, 0, 0.5625, "live"},
		{"API keeps article", "article", "watch", "api", 0, 30, 0, 0.5625, "article"},
		{"API keeps audio", "audio", "watch", "api", 0, 30, 0, 0.5625, "audio"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db, s := videoMetadataDB(t)
			ctx := context.Background()
			it := &Item{SourceID: s.ID, ExternalID: "yt:video:x", URL: tt.url, MediaType: tt.kind,
				DurationSec: tt.seconds, AspectRatio: tt.aspect, PublishedAt: time.Now()}
			if _, err := db.UpsertYouTubeItem(ctx, it); err != nil {
				t.Fatal(err)
			}
			rows, err := db.ItemsAfter(ctx, 0, 1)
			if err != nil || len(rows) != 1 {
				t.Fatalf("seed: %+v, %v", rows, err)
			}
			id := rows[0].ID
			switch tt.writer {
			case "duration":
				err = db.SetItemDuration(ctx, id, tt.incoming, tt.newAspect)
			case "aspect":
				err = db.SetItemAspect(ctx, id, tt.newAspect)
			case "api":
				_, err = db.UpsertYouTubeItem(ctx, &Item{SourceID: s.ID, ExternalID: it.ExternalID,
					URL: "https://youtube.com/watch?v=x", MediaType: "long", DurationSec: tt.incoming,
					AspectRatio: tt.newAspect, PublishedAt: it.PublishedAt})
			}
			if err != nil {
				t.Fatal(err)
			}
			got, found, err := db.EnrichCandidateByID(ctx, id)
			wantDuration, wantAspect := tt.seconds, tt.aspect
			if tt.incoming > 0 {
				wantDuration = tt.incoming
			}
			if tt.newAspect > 0 {
				wantAspect = tt.newAspect
			}
			if err != nil || !found || got.MediaType != tt.want || got.DurationSec != wantDuration || got.AspectRatio != wantAspect || got.URL != tt.url {
				t.Fatalf("merged metadata: %+v, found=%v, err=%v; want %s, %ds, aspect=%v", got, found, err, tt.want, wantDuration, wantAspect)
			}
		})
	}
}

func TestYouTubeMetadataRepairsLegacyKinds(t *testing.T) {
	tests := []struct {
		name, sourceKind, kind string
		seconds                int
		aspect                 float64
		want                   string
	}{
		{"YouTube unknown portrait", "youtube", "unknown", 95, 0.5625, "short"},
		{"YouTube legacy video portrait", "youtube", "video", 95, 0.5625, "short"},
		{"YouTube unknown geometry", "youtube", "unknown", 95, 0, "long"},
		{"YouTube unknown duration", "youtube", "unknown", 0, 0.5625, "long"},
		{"other source unknown", "rss", "unknown", 95, 0.5625, "unknown"},
		{"other source video", "rss", "video", 95, 0.5625, "video"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db, s := videoMetadataDB(t)
			ctx := context.Background()
			if _, err := db.sql.Exec(`UPDATE sources SET kind=? WHERE id=?`, tt.sourceKind, s.ID); err != nil {
				t.Fatal(err)
			}
			it := &Item{SourceID: s.ID, ExternalID: "yt:video:legacy", URL: "watch", MediaType: tt.kind, PublishedAt: time.Now()}
			if _, err := db.UpsertYouTubeItem(ctx, it); err != nil {
				t.Fatal(err)
			}
			it.MediaType, it.DurationSec, it.AspectRatio = "long", tt.seconds, tt.aspect
			if isNew, err := db.UpsertYouTubeItem(ctx, it); err != nil || isNew {
				t.Fatalf("refresh: new=%v, err=%v", isNew, err)
			}
			rows, err := db.ItemsAfter(ctx, 0, 1)
			if err != nil || len(rows) != 1 {
				t.Fatalf("rows=%+v, err=%v", rows, err)
			}
			if got := rows[0]; got.MediaType != tt.want || got.DurationSec != tt.seconds || got.AspectRatio != tt.aspect {
				t.Fatalf("refreshed metadata: %+v, want %s, %ds, aspect=%v", got, tt.want, tt.seconds, tt.aspect)
			}
		})
	}
}

func TestMigrateVideoTypesOnlyPromotesOnce(t *testing.T) {
	db, s := videoMetadataDB(t)
	ctx := context.Background()
	// URL evidence also applies to older items whose source was not YouTube.
	if _, err := db.sql.Exec(`UPDATE sources SET kind='rss' WHERE id=?`, s.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.sql.Exec(`DELETE FROM meta WHERE key='video_types_172'`); err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		kind, url string
		seconds   int
		aspect    float64
		want      string
	}{
		{"long", "watch", 95, 0.5625, "short"},
		{"long", "watch", 180, 1, "short"},
		{"long", "watch", 181, 0.5625, "long"},
		{"long", "watch", 95, 0, "long"},
		{"long", "watch", 95, 1.778, "long"},
		{"long", "watch", 0, 0.5625, "long"},
		{"long", "/shorts/x", 0, 0, "short"},
		{"unknown", "/shorts/x", 0, 0, "short"},
		{"video", "/shorts/x", 0, 0, "short"},
		{"unknown", "watch", 95, 0.5625, "unknown"},
		{"video", "watch", 95, 0.5625, "video"},
		{"short", "watch", 500, 1.778, "short"},
		{"live", "/shorts/x", 30, 0.5625, "live"},
		{"audio", "/shorts/x", 30, 0, "audio"},
		{"article", "/shorts/x", 30, 0, "article"},
	}
	for i, tt := range tests {
		if _, err := db.UpsertYouTubeItem(ctx, &Item{SourceID: s.ID, ExternalID: fmt.Sprint(i), URL: tt.url,
			MediaType: tt.kind, DurationSec: tt.seconds, AspectRatio: tt.aspect, PublishedAt: time.Now()}); err != nil {
			t.Fatal(err)
		}
	}
	// Cross the migration's batch boundary, including a promotion in the next batch.
	for i := len(tests); i < 270; i++ {
		if _, err := db.UpsertYouTubeItem(ctx, &Item{SourceID: s.ID, ExternalID: fmt.Sprint(i), URL: "watch",
			MediaType: "long", DurationSec: 120, AspectRatio: 0.5625, PublishedAt: time.Now()}); err != nil {
			t.Fatal(err)
		}
	}
	if err := migrate(db.sql); err != nil {
		t.Fatal(err)
	}
	rows, err := db.ItemsAfter(ctx, 0, 300)
	if err != nil || len(rows) != 270 {
		t.Fatalf("rows=%d, err=%v", len(rows), err)
	}
	for i, row := range rows {
		want := "short"
		if i < len(tests) {
			want = tests[i].want
		}
		if row.MediaType != want {
			t.Errorf("row %d: type=%s, want %s", i, row.MediaType, want)
		}
	}
	// A second boot must not run the data repair again.
	if _, err := db.sql.Exec(`UPDATE items SET media_type='long' WHERE id=?`, rows[0].ID); err != nil {
		t.Fatal(err)
	}
	if err := migrate(db.sql); err != nil {
		t.Fatal(err)
	}
	got, _, err := db.EnrichCandidateByID(ctx, rows[0].ID)
	if err != nil || got.MediaType != "long" {
		t.Fatalf("repair ran twice: %+v, %v", got, err)
	}
}
