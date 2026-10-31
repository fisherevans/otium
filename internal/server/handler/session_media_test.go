package handler

import (
	"reflect"
	"testing"

	"github.com/fisherevans/otium/internal/server/store"
)

func TestSessionMediaFilter(t *testing.T) {
	tests := []struct {
		name, media string
		shorts      bool
		want        []string
	}{
		{"legacy", "", true, []string{"article", "unknown", "long", "short", "live", "audio"}},
		{"all without shorts", "all", false, []string{"article", "unknown", "long", "live", "audio"}},
		{"reading", "read", true, []string{"article", "unknown"}},
		{"video", "video", true, []string{"long", "short", "live"}},
		{"video without shorts", "video", false, []string{"long", "live"}},
		{"audio", "audio", false, []string{"audio"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var pool []store.Candidate
			for _, media := range []string{"article", "unknown", "long", "short", "live", "audio"} {
				pool = append(pool, store.Candidate{Item: store.Item{MediaType: media}})
			}
			got := filterSessionMedia(pool, tt.media, tt.shorts)
			var kinds []string
			for _, candidate := range got {
				kinds = append(kinds, candidate.MediaType)
			}
			if !reflect.DeepEqual(kinds, tt.want) {
				t.Fatalf("got %v, want %v", kinds, tt.want)
			}
		})
	}
}
func TestValidSessionMedia(t *testing.T) {
	for _, media := range []string{"", "all", "read", "video", "audio"} {
		if !validSessionMedia(media) {
			t.Errorf("rejected %q", media)
		}
	}
	if validSessionMedia("podcast") {
		t.Fatal("accepted unknown media restriction")
	}
}

func TestContentGroupCombinations(t *testing.T) {
	kinds := []string{"article", "audio", "unknown", "", "long", "live", "video", "short"}
	tests := []struct {
		name        string
		types, want []string
	}{
		{"articles include podcasts", []string{"article"}, kinds[:4]},
		{"long includes live", []string{"long"}, kinds[4:7]},
		{"shorts only", []string{"short"}, kinds[7:]},
		{"articles and long", []string{"article", "long"}, kinds[:7]},
		{"articles and short", []string{"article", "short"}, []string{"article", "audio", "unknown", "", "short"}},
		{"all videos", []string{"long", "short"}, kinds[4:]},
		{"everything", []string{"article", "long", "short"}, kinds},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var pool []store.Candidate
			for _, kind := range kinds {
				pool = append(pool, store.Candidate{Item: store.Item{MediaType: kind}})
			}
			got := filterContentTypes(pool, tt.types)
			var actual []string
			for _, c := range got {
				actual = append(actual, c.MediaType)
			}
			if !reflect.DeepEqual(actual, tt.want) {
				t.Fatalf("got %v, want %v", actual, tt.want)
			}
		})
	}
}
