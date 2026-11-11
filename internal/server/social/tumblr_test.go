package social

import "testing"

func TestTumblrHost(t *testing.T) {
	tests := []struct{ in, want string }{
		{"scootyin2d", "scootyin2d.tumblr.com"},
		{"@scootyin2d", "scootyin2d.tumblr.com"},
		{"scootyin2d.tumblr.com", "scootyin2d.tumblr.com"},
		{"https://scootyin2d.tumblr.com/post/832949572771954688", "scootyin2d.tumblr.com"},
		{"https://www.tumblr.com/scootyin2d/832949572771954688/hey-tumblr-void", "scootyin2d.tumblr.com"},
		{"tumblr.com/scootyin2d", "scootyin2d.tumblr.com"},
		{"https://www.tumblr.com/blog/view/scootyin2d", "scootyin2d.tumblr.com"},
		{"https://www.thewakingcloak.com/", "thewakingcloak.com"},
		{"https://www.tumblr.com/dashboard", ""},
		{"", ""},
	}
	for _, tt := range tests {
		if got := TumblrHost(tt.in); got != tt.want {
			t.Errorf("TumblrHost(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}
