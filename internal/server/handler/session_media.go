package handler

import "github.com/fisherevans/otium/internal/server/store"

func validContentTypes(types []string) bool {
	if len(types) == 0 {
		return false
	}
	for _, kind := range types {
		if kind != "article" && kind != "long" && kind != "short" {
			return false
		}
	}
	return true
}

// Content groups are independently selectable. Articles includes audio and all
// other non-video formats; these restrictions do not alter source representation.
func filterContentTypes(pool []store.Candidate, types []string) []store.Candidate {
	selected := make(map[string]bool, len(types))
	for _, kind := range types {
		selected[kind] = true
	}
	kept := pool[:0]
	for _, candidate := range pool {
		group := "article"
		switch candidate.MediaType {
		case "short":
			group = "short"
		case "long", "live", "video":
			group = "long"
		}
		if selected[group] {
			kept = append(kept, candidate)
		}
	}
	return kept
}

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
