package session

import (
	"math"
	"math/rand"
	"reflect"
	"testing"

	"github.com/fisherevans/otium/internal/server/store"
)

// TestAllocateDefaultPathGolden pins the no-mix allocator's output for a fixed
// pool and seed. The #201 refactor (sourcePool) must not change it.
func TestAllocateDefaultPathGolden(t *testing.T) {
	now := goldenNow()
	out := Allocate(goldenPool(now), now, 40, rand.New(rand.NewSource(7)))
	got := make([]int64, len(out))
	for i, s := range out {
		got[i] = s.Item.ID
	}
	want := []int64{44, 39, 65, 63, 26, 58, 57, 5, 71, 56, 52, 35, 66, 28, 30, 67, 60, 51, 21, 59, 31, 43, 2, 14, 29, 24, 23, 22, 13, 16, 4, 12, 1, 6, 9, 8}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("default allocation changed:\n got %v\nwant %v", got, want)
	}
}

func timeShares(picks []MixPick) map[Format]float64 {
	used := map[Format]float64{}
	var total float64
	for _, p := range picks {
		used[p.Format] += p.Cost
		total += p.Cost
	}
	for f := range used {
		used[f] /= total
	}
	return used
}

func TestAllocateMixShares(t *testing.T) {
	now := goldenNow()
	all := []Format{FormatArticle, FormatPost, FormatShort, FormatLong}
	tests := []struct {
		name   string
		shares map[Format]float64
		budget float64
		tol    float64
	}{
		{"even four ways, 8h", map[Format]float64{FormatArticle: 25, FormatPost: 25, FormatShort: 25, FormatLong: 25}, 28800, 0.04},
		{"news heavy, 8h", map[Format]float64{FormatArticle: 60, FormatPost: 10, FormatShort: 10, FormatLong: 20}, 28800, 0.04},
		{"video evening, 8h", map[Format]float64{FormatArticle: 10, FormatShort: 30, FormatLong: 60}, 28800, 0.04},
		{"relative shares need not sum to 100", map[Format]float64{FormatArticle: 1, FormatShort: 1}, 3600, 0.03},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pool, facts := mixPool(now, 4, 400, all...)
			for seed := int64(1); seed <= 5; seed++ {
				_, picks := AllocateMix(pool, facts, Mix{Formats: tt.shares}, now, tt.budget, 1000, rand.New(rand.NewSource(seed)))
				var sum float64
				for _, v := range tt.shares {
					sum += v
				}
				got := timeShares(picks)
				for _, f := range all {
					want := tt.shares[f] / sum
					if math.Abs(got[f]-want) > tt.tol {
						t.Errorf("seed %d: %s share %.3f, want %.3f +/- %.2f", seed, f, got[f], want, tt.tol)
					}
				}
			}
		})
	}
}

// Every prefix of the queue stays close to the target: the session is consumed
// from the head, so the mix must hold early, not only on average.
func TestAllocateMixPrefixWithinHalfItem(t *testing.T) {
	now := goldenNow()
	pool, facts := mixPool(now, 3, 100, FormatArticle, FormatLong)
	mix := Mix{Formats: map[Format]float64{FormatArticle: 50, FormatLong: 50}}
	_, picks := AllocateMix(pool, facts, mix, now, 7200, 1000, rand.New(rand.NewSource(3)))
	var art, long float64
	for _, p := range picks {
		if p.Format == FormatArticle {
			art += p.Cost
		} else {
			long += p.Cost
		}
		// The lag between the two formats never exceeds one long video (25 min).
		if math.Abs(art-long) > 1500+articleCostSec {
			t.Fatalf("prefix drifted: articles %.0fs vs long %.0fs", art, long)
		}
	}
}

// Long videos are charged by length: a 25-minute video uses 1500s of the share,
// so a 50/50 article/long hour holds dozens of articles but only a few videos.
func TestAllocateMixLongVideosCountByTime(t *testing.T) {
	now := goldenNow()
	pool, facts := mixPool(now, 2, 60, FormatArticle, FormatLong)
	mix := Mix{Formats: map[Format]float64{FormatArticle: 50, FormatLong: 50}}
	out, picks := AllocateMix(pool, facts, mix, now, 3600, 1000, rand.New(rand.NewSource(1)))
	counts := map[Format]int{}
	for i, p := range picks {
		counts[p.Format]++
		if p.Format == FormatLong && float64(out[i].Item.DurationSec) != p.Cost {
			t.Fatalf("long video charged %.0fs, duration %ds", p.Cost, out[i].Item.DurationSec)
		}
	}
	if counts[FormatLong] > 5 || counts[FormatArticle] < 30 {
		t.Fatalf("want few long videos and many articles by slot count, got %v", counts)
	}
}

func TestAllocateMixEmptyFormatFallsBack(t *testing.T) {
	now := goldenNow()
	tests := []struct {
		name   string
		shares map[Format]float64
		want   map[Format]float64
	}{
		// No posts in the pool: their 40% renormalizes across the rest (1:1).
		{"missing posts", map[Format]float64{FormatArticle: 30, FormatPost: 40, FormatShort: 30}, map[Format]float64{FormatArticle: 0.5, FormatShort: 0.5}},
		// Only an empty format has a share: nothing is queued, no panic.
		{"only empty format", map[Format]float64{FormatPost: 100}, map[Format]float64{}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pool, facts := mixPool(now, 3, 80, FormatArticle, FormatShort)
			out, picks := AllocateMix(pool, facts, Mix{Formats: tt.shares}, now, 3600, 1000, rand.New(rand.NewSource(2)))
			if len(tt.want) == 0 {
				if len(out) != 0 {
					t.Fatalf("want empty session, got %d items", len(out))
				}
				return
			}
			got := timeShares(picks)
			for f, want := range tt.want {
				if math.Abs(got[f]-want) > 0.05 {
					t.Errorf("%s share %.3f, want %.3f", f, got[f], want)
				}
			}
		})
	}
}

// A format that runs out mid-session drops out and the rest keep filling.
func TestAllocateMixFormatExhaustsMidSession(t *testing.T) {
	now := goldenNow()
	pool, facts := mixPool(now, 1, 3, FormatPost)
	more, moreFacts := mixPool(now, 3, 60, FormatArticle)
	for i := range more {
		more[i].ID += 1000
		more[i].SourceID += 100
	}
	for sid, f := range moreFacts {
		facts[sid+100] = f
	}
	pool = append(pool, more...)
	out, picks := AllocateMix(pool, facts, Mix{Formats: map[Format]float64{FormatArticle: 50, FormatPost: 50}}, now, 1800, 1000, rand.New(rand.NewSource(1)))
	posts := 0
	for _, p := range picks {
		if p.Format == FormatPost {
			posts++
		}
	}
	if posts != 3 || len(out) < 40 {
		t.Fatalf("want all 3 posts then articles to fill 30 min, got %d posts in %d items", posts, len(out))
	}
}

func TestAllocateMixSectionWeights(t *testing.T) {
	now := goldenNow()
	pool, facts := mixPool(now, 4, 100, FormatArticle)
	// Two of the four article sources move to "local".
	facts[1] = store.SourceFacts{Kind: "rss", Section: "local"}
	facts[2] = store.SourceFacts{Kind: "rss", Section: "local"}
	tests := []struct {
		name      string
		sections  map[string]float64
		wantLocal float64 // fraction of items from local sources
		tol       float64
	}{
		{"equal by default", nil, 0.5, 0.08},
		{"local weighted up 3x", map[string]float64{"local": 3}, 0.75, 0.08},
		{"news off", map[string]float64{"news": 0}, 1, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			out, _ := AllocateMix(pool, facts, Mix{Formats: map[Format]float64{FormatArticle: 1}, Sections: tt.sections}, now, 200*articleCostSec, 1000, rand.New(rand.NewSource(5)))
			local := 0
			for _, s := range out {
				if facts[s.Item.SourceID].Section == "local" {
					local++
				}
			}
			got := float64(local) / float64(len(out))
			if math.Abs(got-tt.wantLocal) > tt.tol {
				t.Fatalf("local fraction %.3f, want %.2f", got, tt.wantLocal)
			}
		})
	}
}

func TestFormatOf(t *testing.T) {
	now := goldenNow()
	tests := []struct {
		name, media, kind string
		want              Format
	}{
		{"rss article", "article", "rss", FormatArticle},
		{"podcast audio is an article", "audio", "podcast", FormatArticle},
		{"bluesky post", "article", "bluesky", FormatPost},
		{"substack is an article", "article", "substack", FormatArticle},
		{"short", "short", "youtube", FormatShort},
		{"live counts as long", "live", "youtube", FormatLong},
		{"unknown video counts as long", "video", "youtube", FormatLong},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := acand(1, 1, 0, 0, 0, now)
			c.MediaType = tt.media
			if got := FormatOf(c, tt.kind); got != tt.want {
				t.Fatalf("got %s, want %s", got, tt.want)
			}
		})
	}
}
