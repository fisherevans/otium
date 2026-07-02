// Package importer turns a follow-list export into otium sources. It parses the
// two formats that cover most of what people can actually export in bulk:
//
//   - OPML: the universal feed-list format (Feedly, Inoreader, most podcast
//     apps, any RSS reader). Folders become suggested feeds.
//   - YouTube Takeout CSV: Google Takeout's `subscriptions.csv`
//     (Channel Id, Channel Url, Channel Title) - the clean path for all your
//     YouTube follows; each channel id becomes its RSS feed URL.
//
// As a fallback it also accepts a plain newline/comma list of URLs (paste your
// Reddit/Mastodon/Bluesky feeds).
//
// Parsing never persists - the handler returns candidates for review, then
// commits the ones the user keeps.
package importer

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"encoding/xml"
	"fmt"
	"io"
	"net/url"
	"strings"
)

const maxUnzipBytes = 16 << 20 // per-entry cap, guards against zip bombs

// ExtractImportable accepts a raw upload and, if it's a zip (a Google Takeout or
// a Feedly/podcast export downloads as one), pulls out the importable file:
// subscriptions.csv (YouTube) or the first .opml/.xml. Non-zip input is returned
// as-is. This is what lets someone upload the raw download from their phone
// without unpacking it first.
func ExtractImportable(data []byte) ([]byte, error) {
	if !isZip(data) {
		return data, nil
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, fmt.Errorf("read zip: %w", err)
	}
	// Prefer a YouTube subscriptions.csv anywhere in the tree.
	for _, f := range zr.File {
		if strings.HasSuffix(strings.ToLower(f.Name), "subscriptions.csv") {
			return readZipEntry(f)
		}
	}
	// Otherwise the first OPML/XML feed list.
	for _, f := range zr.File {
		n := strings.ToLower(f.Name)
		if strings.HasSuffix(n, ".opml") || strings.HasSuffix(n, ".xml") {
			return readZipEntry(f)
		}
	}
	return nil, fmt.Errorf("zip has no subscriptions.csv or .opml (a TikTok/Instagram follow list isn't a feed list - send it for handle mapping instead)")
}

func isZip(b []byte) bool {
	return len(b) >= 4 && b[0] == 'P' && b[1] == 'K' && b[2] == 0x03 && b[3] == 0x04
}

func readZipEntry(f *zip.File) ([]byte, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return io.ReadAll(io.LimitReader(rc, maxUnzipBytes))
}

// Candidate is a proposed source, pre-persistence.
type Candidate struct {
	Title       string `json:"title"`
	FeedURL     string `json:"feed_url"`
	HomepageURL string `json:"homepage_url"`
	Kind        string `json:"kind"`     // rss | youtube | podcast
	Category    string `json:"category"` // OPML folder, if any -> suggested feed
}

// Parse detects the format and returns candidates. format is one of
// "opml" | "youtube-csv" | "url-list".
func Parse(data []byte) (cands []Candidate, format string, err error) {
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 {
		return nil, "", fmt.Errorf("empty import")
	}
	switch {
	case looksLikeOPML(trimmed):
		c, err := parseOPML(trimmed)
		return c, "opml", err
	case looksLikeTakeoutCSV(trimmed):
		c, err := parseYouTubeCSV(trimmed)
		return c, "youtube-csv", err
	default:
		return parseURLList(trimmed), "url-list", nil
	}
}

func looksLikeOPML(b []byte) bool {
	head := strings.ToLower(string(b[:min(len(b), 512)]))
	return strings.Contains(head, "<opml") || strings.Contains(head, "<outline")
}

func looksLikeTakeoutCSV(b []byte) bool {
	head := strings.ToLower(string(b[:min(len(b), 256)]))
	return strings.Contains(head, "channel id") && strings.Contains(head, "channel")
}

// --- OPML ---

type opmlDoc struct {
	Body struct {
		Outlines []outline `xml:"outline"`
	} `xml:"body"`
}

type outline struct {
	Text     string    `xml:"text,attr"`
	Title    string    `xml:"title,attr"`
	Type     string    `xml:"type,attr"`
	XMLURL   string    `xml:"xmlUrl,attr"`
	HTMLURL  string    `xml:"htmlUrl,attr"`
	Children []outline `xml:"outline"`
}

func parseOPML(b []byte) ([]Candidate, error) {
	var doc opmlDoc
	if err := xml.Unmarshal(b, &doc); err != nil {
		return nil, fmt.Errorf("parse opml: %w", err)
	}
	var out []Candidate
	var walk func(o outline, category string)
	walk = func(o outline, category string) {
		if o.XMLURL != "" {
			title := firstNonEmpty(o.Title, o.Text, o.XMLURL)
			out = append(out, Candidate{
				Title:       title,
				FeedURL:     o.XMLURL,
				HomepageURL: o.HTMLURL,
				Kind:        kindFor(o.XMLURL, o.Type),
				Category:    category,
			})
			return
		}
		// A folder: its label becomes the category for its children.
		cat := firstNonEmpty(o.Text, o.Title, category)
		for _, c := range o.Children {
			walk(c, cat)
		}
	}
	for _, o := range doc.Body.Outlines {
		walk(o, "")
	}
	return out, nil
}

// --- YouTube Takeout CSV ---

func parseYouTubeCSV(b []byte) ([]Candidate, error) {
	r := csv.NewReader(bytes.NewReader(b))
	r.FieldsPerRecord = -1 // tolerate ragged rows
	rows, err := r.ReadAll()
	if err != nil {
		return nil, fmt.Errorf("parse csv: %w", err)
	}
	if len(rows) < 2 {
		return nil, fmt.Errorf("csv has no data rows")
	}
	idID, idURL, idTitle := -1, -1, -1
	for i, h := range rows[0] {
		switch strings.ToLower(strings.TrimSpace(h)) {
		case "channel id":
			idID = i
		case "channel url":
			idURL = i
		case "channel title":
			idTitle = i
		}
	}
	if idID < 0 {
		return nil, fmt.Errorf("csv missing 'Channel Id' column")
	}
	var out []Candidate
	for _, row := range rows[1:] {
		if idID >= len(row) || strings.TrimSpace(row[idID]) == "" {
			continue
		}
		chID := strings.TrimSpace(row[idID])
		title := chID
		if idTitle >= 0 && idTitle < len(row) {
			title = strings.TrimSpace(row[idTitle])
		}
		home := ""
		if idURL >= 0 && idURL < len(row) {
			home = strings.TrimSpace(row[idURL])
		}
		out = append(out, Candidate{
			Title:       title,
			FeedURL:     "https://www.youtube.com/feeds/videos.xml?channel_id=" + chID,
			HomepageURL: home,
			Kind:        "youtube",
		})
	}
	return out, nil
}

// --- URL list fallback ---

func parseURLList(b []byte) []Candidate {
	fields := strings.FieldsFunc(string(b), func(r rune) bool {
		return r == '\n' || r == '\r' || r == ',' || r == ' ' || r == '\t'
	})
	seen := map[string]bool{}
	var out []Candidate
	for _, f := range fields {
		f = strings.TrimSpace(f)
		if f == "" || !strings.Contains(f, ".") || seen[f] {
			continue
		}
		if !strings.HasPrefix(f, "http") {
			f = "https://" + f
		}
		seen[f] = true
		out = append(out, Candidate{
			Title:   hostOf(f),
			FeedURL: f,
			Kind:    kindFor(f, ""),
		})
	}
	return out
}

// --- helpers ---

func kindFor(feedURL, typ string) string {
	if strings.EqualFold(typ, "podcast") {
		return "podcast"
	}
	if strings.Contains(strings.ToLower(feedURL), "youtube.com") {
		return "youtube"
	}
	return "rss"
}

func hostOf(u string) string {
	if p, err := url.Parse(u); err == nil && p.Host != "" {
		return strings.TrimPrefix(p.Host, "www.")
	}
	return u
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
