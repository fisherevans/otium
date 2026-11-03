package session

import (
	"testing"
	"time"

	"github.com/fisherevans/otium/internal/server/store"
)

func pcand(id int64, ageHours float64, likes, reposts, replies int, now time.Time) store.Candidate {
	c := store.Candidate{}
	c.ID = id
	c.SourceID = 1
	c.PublishedAt = now.Add(-time.Duration(ageHours * float64(time.Hour)))
	c.Likes, c.Reposts, c.Replies = likes, reposts, replies
	return c
}

func TestOrderSourcePopular(t *testing.T) {
	now := time.Date(2026, 11, 3, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		name  string
		cands []store.Candidate
		want  []int64
	}{
		{"engagement beats recency at similar age", []store.Candidate{
			pcand(1, 2, 0, 0, 0, now),
			pcand(2, 3, 200, 10, 5, now),
			pcand(3, 4, 20, 0, 1, now),
		}, []int64{2, 3, 1}},
		{"a day-old hit loses to a fresh post doing well", []store.Candidate{
			pcand(1, 30, 400, 20, 10, now),
			pcand(2, 1, 60, 5, 2, now),
		}, []int64{2, 1}},
		{"reposts weigh more than likes", []store.Candidate{
			pcand(1, 5, 30, 0, 0, now),
			pcand(2, 5, 10, 15, 0, now),
		}, []int64{2, 1}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cs := append([]store.Candidate(nil), tt.cands...)
			scores := orderSource(cs, ScoringConfig{Direction: "popular"}, 7, now)
			for i, id := range tt.want {
				if cs[i].ID != id {
					t.Fatalf("position %d = item %d, want %d (scores %v)", i, cs[i].ID, id, scores)
				}
			}
			for id, s := range scores {
				if s < popularFloor || s > 1 {
					t.Errorf("item %d score %v outside [%v,1]", id, s, popularFloor)
				}
			}
		})
	}
}

func TestPopularIsNotDefault(t *testing.T) {
	if parseScoring(`{"direction":"popular"}`).isDefault() {
		t.Fatal("popular must take the facet path")
	}
}
