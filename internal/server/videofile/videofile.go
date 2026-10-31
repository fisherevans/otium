// Package videofile fetches a short YouTube video as a shareable MP4 (#180), so a
// clip can be saved to Photos or sent to someone from the phone's share sheet.
//
// It shells out to yt-dlp, which needs a JavaScript runtime for YouTube's player
// challenges and ffmpeg to merge separate video/audio streams. All three ship in
// the server image. Release images are never rebuilt, so the image's yt-dlp is
// copied into Dir/.bin on first use and self-updated (yt-dlp -U, which checks the
// release checksums) at most once a day before a download. Files are cached under Dir by video ID and pruned after
// MaxAge; concurrent requests for the same ID share one download. A Fetcher is
// safe for concurrent use and holds no resources beyond the cache directory.
package videofile

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// MaxDurationSec bounds what may be fetched: this is for short clips, not a
// general video downloader.
const MaxDurationSec = 180

const maxBytes = 60_000_000

var (
	idPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)

	// ErrUnsupported means the URL is not a YouTube video otium can fetch.
	ErrUnsupported = errors.New("not a YouTube video")
	// ErrUnavailable means yt-dlp is not installed in this environment.
	ErrUnavailable = errors.New("video downloads are not available here")
)

type Fetcher struct {
	Dir     string
	YtDlp   string        // yt-dlp executable
	Runtime string        // yt-dlp --js-runtimes value, e.g. "node"
	Timeout time.Duration // per download
	MaxAge  time.Duration // cache lifetime
	// UpdateEvery is how often the private yt-dlp copy self-updates; 0 runs
	// the configured binary directly with no copy or update.
	UpdateEvery time.Duration

	mu         sync.Mutex
	inflight   map[string]*call
	lastUpdate time.Time
}

type call struct {
	done chan struct{}
	path string
	err  error
}

func New(dir, ytdlp, runtime string) *Fetcher {
	return &Fetcher{Dir: dir, YtDlp: ytdlp, Runtime: runtime, Timeout: 90 * time.Second, MaxAge: 7 * 24 * time.Hour}
}

// binary returns the yt-dlp to run: the configured one, or with UpdateEvery set,
// a private copy under Dir/.bin refreshed when due. Callers hold no lock; a
// download in flight for another ID may race an update, which yt-dlp handles by
// replacing the file atomically.
func (f *Fetcher) binary() (string, error) {
	src, err := exec.LookPath(f.YtDlp)
	if err != nil {
		return "", ErrUnavailable
	}
	if f.UpdateEvery <= 0 {
		return src, nil
	}
	own := filepath.Join(f.Dir, ".bin", "yt-dlp")
	if _, err := os.Stat(own); err != nil {
		if err := copyExecutable(src, own); err != nil {
			return src, nil
		}
	}
	f.mu.Lock()
	due := time.Since(f.lastUpdate) > f.UpdateEvery
	if due {
		f.lastUpdate = time.Now()
	}
	f.mu.Unlock()
	if due {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		exec.CommandContext(ctx, own, "--ignore-config", "-U").Run()
		cancel()
	}
	return own, nil
}

func copyExecutable(src, dst string) error {
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	tmp := dst + ".tmp"
	if err := os.WriteFile(tmp, data, 0o755); err != nil {
		return err
	}
	return os.Rename(tmp, dst)
}

// YouTubeID extracts the 11-character video ID from watch, shorts, embed and
// youtu.be URLs.
func YouTubeID(raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return "", ErrUnsupported
	}
	host := strings.TrimPrefix(strings.ToLower(u.Hostname()), "www.")
	host = strings.TrimPrefix(host, "m.")
	var id string
	switch host {
	case "youtu.be":
		id = strings.Trim(u.Path, "/")
	case "youtube.com", "youtube-nocookie.com":
		parts := strings.Split(strings.Trim(u.Path, "/"), "/")
		switch {
		case len(parts) == 1 && parts[0] == "watch":
			id = u.Query().Get("v")
		case len(parts) == 2 && (parts[0] == "shorts" || parts[0] == "embed" || parts[0] == "live"):
			id = parts[1]
		}
	}
	if !idPattern.MatchString(id) {
		return "", ErrUnsupported
	}
	return id, nil
}

// Fetch returns the path of a cached MP4 for the video, downloading it first if
// needed.
func (f *Fetcher) Fetch(ctx context.Context, id string) (string, error) {
	if !idPattern.MatchString(id) {
		return "", ErrUnsupported
	}
	path := filepath.Join(f.Dir, id+".mp4")
	if st, err := os.Stat(path); err == nil && st.Size() > 0 {
		return path, nil
	}

	f.mu.Lock()
	if f.inflight == nil {
		f.inflight = map[string]*call{}
	}
	if c, ok := f.inflight[id]; ok {
		f.mu.Unlock()
		select {
		case <-c.done:
			return c.path, c.err
		case <-ctx.Done():
			return "", ctx.Err()
		}
	}
	c := &call{done: make(chan struct{})}
	f.inflight[id] = c
	f.mu.Unlock()

	// Detached from the request: a client that gives up should not waste a
	// download another tap is about to ask for again.
	c.path, c.err = f.download(id, path)
	f.mu.Lock()
	delete(f.inflight, id)
	f.mu.Unlock()
	close(c.done)
	go f.prune()
	return c.path, c.err
}

func (f *Fetcher) download(id, path string) (string, error) {
	bin, err := f.binary()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(f.Dir, 0o755); err != nil {
		return "", err
	}
	work, err := os.MkdirTemp(f.Dir, "dl-"+id+"-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(work)

	ctx, cancel := context.WithTimeout(context.Background(), f.Timeout)
	defer cancel()
	// H.264/AAC MP4 is what iOS Photos accepts; 720p keeps a Short small.
	args := []string{
		"--ignore-config", "--no-playlist", "--no-progress", "--quiet", "--no-warnings",
		"--cache-dir", filepath.Join(f.Dir, ".yt-dlp-cache"),
		"--socket-timeout", "15", "--retries", "1",
		"--max-filesize", fmt.Sprint(maxBytes),
		"--match-filters", fmt.Sprintf("!is_live & duration <= %d", MaxDurationSec),
		"--format", "bv[ext=mp4][vcodec^=avc1][height<=720]+ba[ext=m4a][acodec^=mp4a]/b[ext=mp4][vcodec^=avc1][acodec^=mp4a]",
		"--merge-output-format", "mp4",
		"--output", filepath.Join(work, "video.%(ext)s"),
	}
	if f.Runtime != "" {
		args = append(args, "--js-runtimes", f.Runtime)
	}
	args = append(args, "https://www.youtube.com/watch?v="+id)
	out, err := exec.CommandContext(ctx, bin, args...).CombinedOutput()
	got := filepath.Join(work, "video.mp4")
	st, statErr := os.Stat(got)
	if err != nil || statErr != nil || st.Size() == 0 {
		msg := strings.TrimSpace(string(out))
		if len(msg) > 400 {
			msg = msg[len(msg)-400:]
		}
		if err == nil {
			err = errors.New("no file produced (too long, live, or too large?)")
		}
		return "", fmt.Errorf("yt-dlp %s: %w: %s", id, err, msg)
	}
	if err := os.Rename(got, path); err != nil {
		return "", err
	}
	return path, nil
}

// prune removes cached files older than MaxAge and abandoned work directories.
func (f *Fetcher) prune() {
	entries, err := os.ReadDir(f.Dir)
	if err != nil {
		return
	}
	cutoff := time.Now().Add(-f.MaxAge)
	for _, e := range entries {
		if e.Name() == ".yt-dlp-cache" || e.Name() == ".bin" {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		stale := info.ModTime().Before(cutoff)
		if e.IsDir() && strings.HasPrefix(e.Name(), "dl-") && info.ModTime().Before(time.Now().Add(-time.Hour)) {
			stale = true
		}
		if stale {
			os.RemoveAll(filepath.Join(f.Dir, e.Name()))
		}
	}
}
