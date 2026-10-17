package handler

import "github.com/fisherevans/otium/internal/server/store"

func validSessionMedia(media string) bool {
	return media == "" || media == "all" || media == "read" || media == "video" || media == "audio"
}

// Media is a pool restriction, applied before source allocation. It does not
// change source weights, article ranking or the stored queue's resume behavior.
func filterSessionMedia(pool []store.Candidate, media string, includeShorts bool) []store.Candidate {
	kept := pool[:0]
	for _, candidate := range pool {
		kind := candidate.MediaType
		if !includeShorts && kind == "short" {
			continue
		}
		video := kind == "long" || kind == "short" || kind == "live"
		switch media {
		case "video":
			if !video {
				continue
			}
		case "audio":
			if kind != "audio" {
				continue
			}
		case "read":
			if video || kind == "audio" {
				continue
			}
		}
		kept = append(kept, candidate)
	}
	return kept
}
