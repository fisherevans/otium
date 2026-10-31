// Package media owns otium's content grouping rules, independent of ingestion
// and storage. These groups describe a viewing experience, not platform labels.
package media

import "strings"

// VideoType groups a video using the available metadata. The <=90-second rule
// preserves existing short-form behavior; square/vertical videos can be up to
// three minutes. Unknown geometry never qualifies for that extension. Explicit
// Shorts URLs and live classifications survive later metadata enrichment.
func VideoType(current, rawURL string, durationSec int, aspectRatio float64) string {
	if current == "live" {
		return "live"
	}
	if strings.Contains(rawURL, "/shorts/") {
		return "short"
	}
	if durationSec <= 0 {
		if current == "short" {
			return "short"
		}
		return "long"
	}
	if durationSec <= 90 || (durationSec <= 180 && aspectRatio > 0 && aspectRatio <= 1) {
		return "short"
	}
	return "long"
}
