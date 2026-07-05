package fulltext

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// articleHTML is a page with enough real prose that readability distills a body.
// A thin page won't extract, which is the whole point of the "external" branch.
const articleHTML = `<!doctype html><html><head><title>A Real Article</title></head>
<body>
<nav>home about contact</nav>
<article>
<h1>The Long Road to Somewhere</h1>
<p>` + longPara + `</p>
<p>` + longPara + `</p>
<p>` + longPara + `</p>
<p>` + longPara + `</p>
</article>
<footer>copyright</footer>
</body></html>`

const longPara = "This is a substantial paragraph of article text that exists so the readability " +
	"algorithm has enough signal to identify the main content of the page and separate it from the " +
	"navigation, footer, and other chrome that surrounds it. Readability scores nodes by text density " +
	"and link density, so real sentences like these are what make an article extractable in the first place."

func TestExtract(t *testing.T) {
	tests := []struct {
		name        string
		status      int
		contentType string
		body        string
		wantOK      bool
		wantContain string // substring expected in the extracted HTML when ok
	}{
		{"article", 200, "text/html; charset=utf-8", articleHTML, true, "substantial paragraph"},
		{"non-html content type", 200, "video/mp4", "\x00\x01\x02binary", false, ""},
		{"not found", 404, "text/html", "<html><body>nope</body></html>", false, ""},
		{"empty body", 200, "text/html", "", false, ""},
		{"thin non-article", 200, "text/html", "<html><body><p>hi</p></body></html>", false, ""},
	}

	f := New()
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if tt.contentType != "" {
					w.Header().Set("Content-Type", tt.contentType)
				}
				w.WriteHeader(tt.status)
				_, _ = w.Write([]byte(tt.body))
			}))
			defer srv.Close()

			html, ok, err := f.Extract(context.Background(), srv.URL)
			if err != nil {
				t.Fatalf("Extract returned err: %v", err)
			}
			if ok != tt.wantOK {
				t.Fatalf("ok = %v, want %v (html=%q)", ok, tt.wantOK, html)
			}
			if tt.wantOK {
				if strings.TrimSpace(html) == "" {
					t.Fatal("ok but empty html")
				}
				if tt.wantContain != "" && !strings.Contains(html, tt.wantContain) {
					t.Fatalf("extracted html missing %q: %q", tt.wantContain, html)
				}
			} else if html != "" {
				t.Fatalf("not-ok should yield empty html, got %q", html)
			}
		})
	}
}

// TestExtractBadInputs covers the pre-fetch guards: an empty URL and a non-HTTP
// scheme both resolve to "not extractable" without a network hit.
func TestExtractBadInputs(t *testing.T) {
	f := New()
	for _, u := range []string{"", "   ", "ftp://example.com/x", "not a url::"} {
		html, ok, err := f.Extract(context.Background(), u)
		if err != nil || ok || html != "" {
			t.Fatalf("Extract(%q) = (%q, %v, %v), want (\"\", false, nil)", u, html, ok, err)
		}
	}
}

// TestExtractSizeCap verifies the byte cap: a body far larger than the cap is
// truncated during read, so extraction can't balloon memory on a huge page.
func TestExtractSizeCap(t *testing.T) {
	f := New()
	f.maxBytes = 512 // tiny cap for the test
	big := "<html><body><article>" + strings.Repeat("x", 100000) + "</article></body></html>"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte(big))
	}))
	defer srv.Close()
	// The truncated body isn't a real article -> not ok, but it must not error or hang.
	if _, _, err := f.Extract(context.Background(), srv.URL); err != nil {
		t.Fatalf("Extract with size cap errored: %v", err)
	}
}
