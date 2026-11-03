package session

import (
	"math/rand"
	"time"

	"github.com/fisherevans/otium/internal/server/store"
)

func goldenNow() time.Time { return time.Date(2026, 11, 3, 12, 0, 0, 0, time.UTC) }

// goldenPool is a fixed, mixed pool: several sources with different
// representations, media types, a non-default scoring config and archived items.
// Its Allocate output is pinned by TestAllocateDefaultPathGolden.
func goldenPool(now time.Time) []store.Candidate {
	r := rand.New(rand.NewSource(42))
	reprs := []float64{0.25, 0.5, 1, 1, 2, 4}
	media := []string{"article", "article", "short", "long", "article", "audio"}
	var pool []store.Candidate
	id := int64(1)
	for s := 0; s < 6; s++ {
		for i := 0; i < 12; i++ {
			c := acand(int64(s+1), reprs[s], r.Float64()*40, 0, 0, now)
			c.ID = id
			c.MediaType = media[s]
			if s == 4 {
				c.ScoringConfig = `{"direction":"random"}`
			}
			pool = append(pool, c)
			id++
		}
	}
	return pool
}

// mixPool builds a large pool: per format, `sources` sources with `perSource`
// fresh items each. Long videos alternate 8 and 25 minutes; Shorts are 45s.
func mixPool(now time.Time, sources, perSource int, formats ...Format) ([]store.Candidate, map[int64]store.SourceFacts) {
	var pool []store.Candidate
	facts := map[int64]store.SourceFacts{}
	id, sid := int64(1), int64(1)
	for _, f := range formats {
		for s := 0; s < sources; s++ {
			kind, section := "rss", "news"
			switch f {
			case FormatPost:
				kind = "bluesky"
			case FormatShort, FormatLong:
				kind, section = "youtube", "videos"
			}
			facts[sid] = store.SourceFacts{Kind: kind, Section: section}
			for i := 0; i < perSource; i++ {
				c := acand(sid, 1, float64(i)*0.05, 0, 0, now)
				c.ID = id
				switch f {
				case FormatShort:
					c.MediaType, c.DurationSec = "short", 45
				case FormatLong:
					c.MediaType, c.DurationSec = "long", []int{480, 1500}[i%2]
				default:
					c.MediaType = "article"
				}
				pool = append(pool, c)
				id++
			}
			sid++
		}
	}
	return pool, facts
}
