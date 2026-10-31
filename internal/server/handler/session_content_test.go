package handler

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/fisherevans/otium/internal/server/middleware"
	"github.com/fisherevans/otium/internal/server/session"
	"github.com/fisherevans/otium/internal/server/store"
)

func TestCreateSessionContentTypes(t *testing.T) {
	db, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx := context.Background()
	user, err := db.UpsertUserByUsername(ctx, "tester", "")
	if err != nil {
		t.Fatal(err)
	}
	source, err := db.CreateSource(ctx, &store.Source{UserID: user.ID, Title: "Mixed source", FeedURL: "https://example.test/feed", State: "followed", Weight: 1})
	if err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"article", "audio", "long", "short", "live"} {
		_, err = db.UpsertItem(ctx, &store.Item{SourceID: source.ID, ExternalID: kind, URL: "https://example.test/" + kind, Title: kind, MediaType: kind, DurationSec: 30, PublishedAt: time.Now().UTC()})
		if err != nil {
			t.Fatal(err)
		}
	}
	h := New(db, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	authenticated := middleware.RequireAuth(func(*http.Request) (*middleware.Identity, error) { return &middleware.Identity{UserID: user.ID}, nil })(http.HandlerFunc(h.CreateSession))
	tests := []struct {
		name, body string
		status     int
		want       []string
	}{
		{"shorts only", `{"content_types":["short"]}`, 201, []string{"short"}},
		{"articles and podcasts", `{"content_types":["article"]}`, 201, []string{"article", "audio"}},
		{"long and live", `{"content_types":["long"]}`, 201, []string{"live", "long"}},
		{"new selection takes precedence", `{"content_types":["short"],"media":"read","include_shorts":false}`, 201, []string{"short"}},
		{"legacy video", `{"media":"video","include_shorts":false}`, 201, []string{"live", "long"}},
		{"legacy audio", `{"media":"audio"}`, 201, []string{"audio"}},
		{"legacy read", `{"media":"read"}`, 201, []string{"article"}},
		{"empty selection", `{"content_types":[]}`, 400, nil},
		{"unknown content type", `{"content_types":["podcast"]}`, 400, nil},
		{"wrong content shape", `{"content_types":"short"}`, 400, nil},
		{"legacy invalid media", `{"media":"podcast"}`, 400, nil},
		{"duplicate choice", `{"content_types":["short","short"]}`, 201, []string{"short"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			request := httptest.NewRequest("POST", "/sessions", strings.NewReader(tt.body))
			response := httptest.NewRecorder()
			authenticated.ServeHTTP(response, request)
			if response.Code != tt.status {
				t.Fatalf("status %d: %s", response.Code, response.Body.String())
			}
			if tt.status != 201 {
				return
			}
			var payload struct {
				ID    string             `json:"session_id"`
				Items []session.Selected `json:"items"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
				t.Fatal(err)
			}
			if payload.ID == "" {
				t.Fatal("missing session")
			}
			var got []string
			for _, item := range payload.Items {
				got = append(got, item.Item.MediaType)
			}
			sort.Strings(got)
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("got %v, want %v", got, tt.want)
			}
		})
	}
}
