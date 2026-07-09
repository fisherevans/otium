package enrich

import "testing"

func TestVideoIDFromURL(t *testing.T) {
	tests := []struct {
		name, in, want string
	}{
		{"watch", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"},
		{"watch extra params", "https://www.youtube.com/watch?v=abc123&t=30s", "abc123"},
		{"youtu.be", "https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"},
		{"shorts", "https://www.youtube.com/shorts/xyz789", "xyz789"},
		{"no id", "https://www.youtube.com/", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := videoIDFromURL(tt.in); got != tt.want {
				t.Errorf("videoIDFromURL(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}
