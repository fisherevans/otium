package videofile

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestYouTubeID(t *testing.T) {
	tests := []struct {
		name, url, want string
	}{
		{"watch", "https://www.youtube.com/watch?v=HsupROqCZ7c", "HsupROqCZ7c"},
		{"watch extra params", "https://youtube.com/watch?v=HsupROqCZ7c&t=3s", "HsupROqCZ7c"},
		{"shorts", "https://www.youtube.com/shorts/abcDEF123_-", "abcDEF123_-"},
		{"mobile shorts", "https://m.youtube.com/shorts/abcDEF123_-", "abcDEF123_-"},
		{"short link", "https://youtu.be/abcDEF123_-", "abcDEF123_-"},
		{"embed", "https://www.youtube-nocookie.com/embed/abcDEF123_-", "abcDEF123_-"},
		{"channel", "https://www.youtube.com/channel/UCabc", ""},
		{"other host", "https://vimeo.com/watch?v=abcDEF123_-", ""},
		{"bad id", "https://youtu.be/abc", ""},
		{"injection", "https://youtu.be/--exec=sh", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := YouTubeID(tt.url)
			if tt.want == "" {
				if !errors.Is(err, ErrUnsupported) {
					t.Fatalf("YouTubeID(%q) = %q, %v; want ErrUnsupported", tt.url, got, err)
				}
				return
			}
			if err != nil || got != tt.want {
				t.Fatalf("YouTubeID(%q) = %q, %v; want %q", tt.url, got, err, tt.want)
			}
		})
	}
}

func TestFetchCachedAndUnavailable(t *testing.T) {
	dir := t.TempDir()
	f := New(dir, "otium-no-such-yt-dlp", "")
	if _, err := f.Fetch(context.Background(), "abcDEF123_-"); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("missing yt-dlp: got %v, want ErrUnavailable", err)
	}
	cached := filepath.Join(dir, "abcDEF123_-.mp4")
	if err := os.WriteFile(cached, []byte("mp4"), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := f.Fetch(context.Background(), "abcDEF123_-")
	if err != nil || got != cached {
		t.Fatalf("cached: got %q, %v", got, err)
	}
	if _, err := f.Fetch(context.Background(), "../etc/pass"); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("bad id: got %v", err)
	}
}
