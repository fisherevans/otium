package handler

import (
	"strings"
	"testing"
)

func TestShareURL(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"short", "https://www.youtube.com/shorts/abc123", "https://www.youtube.com/watch?v=abc123"},
		{"short no www", "https://youtube.com/shorts/abc123/", "https://www.youtube.com/watch?v=abc123"},
		{"watch untouched", "https://www.youtube.com/watch?v=abc123", "https://www.youtube.com/watch?v=abc123"},
		{"article untouched", "https://example.com/shorts/story", "https://example.com/shorts/story"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ShareURL(tt.in); got != tt.want {
				t.Fatalf("ShareURL(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestShareMessage(t *testing.T) {
	tests := []struct {
		name     string
		note     string
		friend   bool
		contains []string
		absent   []string
	}{
		{"friend with note", "watch this\nseriously", true,
			[]string{"**Fisher** shared:", "> watch this\n> seriously\n", "https://x.test/a", "<https://share.test/s/>"}, nil},
		{"channel no history link", "", false,
			[]string{"**Fisher** shared:\nhttps://x.test/a"}, []string{"share.test"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ShareMessage("Fisher", "https://x.test/a", tt.note, "https://share.test/s/", tt.friend)
			for _, c := range tt.contains {
				if !strings.Contains(got, c) {
					t.Errorf("message %q missing %q", got, c)
				}
			}
			for _, a := range tt.absent {
				if strings.Contains(got, a) {
					t.Errorf("message %q should not contain %q", got, a)
				}
			}
		})
	}
}

func TestSignedValue(t *testing.T) {
	h := &Handler{share: SharingConfig{Secret: []byte("k")}}
	v := h.signedValue("123|999")
	if got, ok := h.openSigned(v); !ok || got != "123|999" {
		t.Fatalf("round trip = %q %v", got, ok)
	}
	if _, ok := h.openSigned(v + "x"); ok {
		t.Fatal("tampered signature accepted")
	}
	other := &Handler{share: SharingConfig{Secret: []byte("other")}}
	if _, ok := other.openSigned(v); ok {
		t.Fatal("value signed with another key accepted")
	}
}
