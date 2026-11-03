package handler

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"html/template"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/fisherevans/otium/internal/server/store"
	"github.com/go-chi/chi/v5"
)

// The friend-facing pages (#195) live under /s and are the only part of otium
// reachable without the owner's login; in production only share.fisher.sh routes
// to them. A friend is identified by Discord alone: a connect link (one-time
// token) or a Discord sign-in sets a signed cookie holding their Discord user id,
// and the history page shows what was shared with that id. Nothing else in otium
// is readable from here.

const (
	friendCookie    = "otium_friend"
	friendCookieTTL = 180 * 24 * time.Hour
	stateTTL        = 15 * time.Minute
)

type oauthState struct {
	Kind  string `json:"k"`           // c = connect, h = history sign-in
	Token string `json:"t,omitempty"` // connect token
	Exp   int64  `json:"e"`
}

func (h *Handler) sign(payload string) string {
	m := hmac.New(sha256.New, h.share.Secret)
	m.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

func (h *Handler) signedValue(payload string) string {
	enc := base64.RawURLEncoding.EncodeToString([]byte(payload))
	return enc + "." + h.sign(enc)
}

func (h *Handler) openSigned(v string) (string, bool) {
	enc, sig, ok := strings.Cut(v, ".")
	if !ok || !hmac.Equal([]byte(sig), []byte(h.sign(enc))) {
		return "", false
	}
	raw, err := base64.RawURLEncoding.DecodeString(enc)
	if err != nil {
		return "", false
	}
	return string(raw), true
}

func (h *Handler) newState(kind, token string) string {
	b, _ := json.Marshal(oauthState{Kind: kind, Token: token, Exp: time.Now().Add(stateTTL).Unix()})
	return h.signedValue(string(b))
}

func (h *Handler) readState(v string) (*oauthState, bool) {
	raw, ok := h.openSigned(v)
	if !ok {
		return nil, false
	}
	var st oauthState
	if json.Unmarshal([]byte(raw), &st) != nil || time.Now().Unix() > st.Exp {
		return nil, false
	}
	return &st, true
}

func (h *Handler) setFriendCookie(w http.ResponseWriter, discordUserID string) {
	exp := time.Now().Add(friendCookieTTL)
	http.SetCookie(w, &http.Cookie{
		Name: friendCookie, Value: h.signedValue(discordUserID + "|" + strconv.FormatInt(exp.Unix(), 10)),
		Path: "/s", Expires: exp, HttpOnly: true, Secure: strings.HasPrefix(h.share.PublicBaseURL, "https://"),
		SameSite: http.SameSiteLaxMode,
	})
}

func (h *Handler) friendFromCookie(r *http.Request) string {
	c, err := r.Cookie(friendCookie)
	if err != nil {
		return ""
	}
	raw, ok := h.openSigned(c.Value)
	if !ok {
		return ""
	}
	id, exp, ok := strings.Cut(raw, "|")
	n, _ := strconv.ParseInt(exp, 10, 64)
	if !ok || time.Now().Unix() > n {
		return ""
	}
	return id
}

func (h *Handler) ownerDisplay() string {
	if h.share.OwnerName != "" {
		return h.share.OwnerName
	}
	return "Your friend"
}

func publicHeaders(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("X-Content-Type-Options", "nosniff")
}

func (h *Handler) render(w http.ResponseWriter, status int, name string, data map[string]any) {
	publicHeaders(w)
	w.WriteHeader(status)
	if data == nil {
		data = map[string]any{}
	}
	data["Owner"] = h.ownerDisplay()
	if err := publicTmpl.ExecuteTemplate(w, name, data); err != nil {
		h.log.Error("render share page", "page", name, "err", err)
	}
}

func (h *Handler) publicOff(w http.ResponseWriter) bool {
	if h.sharingOn() {
		return false
	}
	h.render(w, http.StatusServiceUnavailable, "message", map[string]any{"Title": "Not available", "Body": "Sharing isn't set up here."})
	return true
}

// ShareHome is the friend's history, or a Discord sign-in prompt.
func (h *Handler) ShareHome(w http.ResponseWriter, r *http.Request) {
	if h.publicOff(w) {
		return
	}
	id := h.friendFromCookie(r)
	if id == "" {
		h.render(w, http.StatusOK, "signin", nil)
		return
	}
	ok, err := h.db.IsShareFriend(r.Context(), id)
	if err != nil {
		h.log.Error("share home", "err", err)
		h.render(w, http.StatusInternalServerError, "message", map[string]any{"Title": "Something went wrong", "Body": "Try again in a minute."})
		return
	}
	if !ok {
		h.render(w, http.StatusOK, "message", map[string]any{
			"Title": "Nothing here yet",
			"Body":  "This Discord account isn't connected. Ask " + h.ownerDisplay() + " for a connect link.",
		})
		return
	}
	streams, err := h.db.FriendHistory(r.Context(), id, 500)
	if err != nil {
		h.log.Error("friend history", "err", err)
		h.render(w, http.StatusInternalServerError, "message", map[string]any{"Title": "Something went wrong", "Body": "Try again in a minute."})
		return
	}
	h.render(w, http.StatusOK, "history", map[string]any{
		"Streams":   historyView(streams),
		"Connected": r.URL.Query().Get("connected") == "1",
	})
}

type streamView struct {
	Label  string
	Shares []store.Share
}

func historyView(streams []store.FriendStream) []streamView {
	out := make([]streamView, 0, len(streams))
	for _, s := range streams {
		label := "Just you"
		if len(s.Others) > 0 {
			label = "You and " + joinNames(s.Others)
		}
		out = append(out, streamView{Label: label, Shares: s.Shares})
	}
	return out
}

func joinNames(ns []string) string {
	switch len(ns) {
	case 0:
		return ""
	case 1:
		return ns[0]
	case 2:
		return ns[0] + " and " + ns[1]
	}
	return strings.Join(ns[:len(ns)-1], ", ") + " and " + ns[len(ns)-1]
}

// ShareSignIn starts a Discord sign-in for an already-connected friend.
func (h *Handler) ShareSignIn(w http.ResponseWriter, r *http.Request) {
	if h.publicOff(w) {
		return
	}
	http.Redirect(w, r, h.share.Discord.AuthorizeURL(h.newState("h", ""), false), http.StatusFound)
}

func (h *Handler) ShareSignOut(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: friendCookie, Value: "", Path: "/s", MaxAge: -1})
	http.Redirect(w, r, "/s/", http.StatusFound)
}

// ShareConnect is the landing page for a friend's connect link. It explains what
// approving does (joins them to the share server) before sending them to Discord.
func (h *Handler) ShareConnect(w http.ResponseWriter, r *http.Request) {
	if h.publicOff(w) {
		return
	}
	token := chi.URLParam(r, "token")
	t, _, err := h.db.ShareTargetByToken(r.Context(), token)
	if err != nil {
		h.log.Error("share connect", "err", err)
	}
	if t == nil {
		h.render(w, http.StatusNotFound, "message", map[string]any{
			"Title": "This link has expired",
			"Body":  "Connect links work once and last a week. Ask " + h.ownerDisplay() + " for a new one.",
		})
		return
	}
	h.render(w, http.StatusOK, "connect", map[string]any{
		"Go": h.share.Discord.AuthorizeURL(h.newState("c", token), true),
	})
}

// ShareCallback finishes the Discord OAuth round trip for both connect and
// sign-in.
func (h *Handler) ShareCallback(w http.ResponseWriter, r *http.Request) {
	if h.publicOff(w) {
		return
	}
	q := r.URL.Query()
	st, ok := h.readState(q.Get("state"))
	if !ok {
		h.render(w, http.StatusBadRequest, "message", map[string]any{"Title": "That didn't work", "Body": "The sign-in took too long or the link was changed. Start again from the link you were sent."})
		return
	}
	if q.Get("error") != "" || q.Get("code") == "" {
		h.render(w, http.StatusOK, "message", map[string]any{"Title": "Not connected", "Body": "Discord sign-in was cancelled. Open the link again if you change your mind."})
		return
	}
	dc := h.share.Discord
	tok, err := dc.ExchangeCode(r.Context(), q.Get("code"))
	if err != nil {
		h.log.Warn("discord code exchange", "err", err)
		h.render(w, http.StatusBadGateway, "message", map[string]any{"Title": "That didn't work", "Body": "Discord didn't accept the sign-in. Start again from the link you were sent."})
		return
	}
	me, err := dc.Me(r.Context(), tok.AccessToken)
	if err != nil {
		h.log.Warn("discord me", "err", err)
		h.render(w, http.StatusBadGateway, "message", map[string]any{"Title": "That didn't work", "Body": "Couldn't read your Discord account. Try again."})
		return
	}

	if st.Kind == "c" {
		t, _, err := h.db.ShareTargetByToken(r.Context(), st.Token)
		if err != nil || t == nil {
			h.render(w, http.StatusNotFound, "message", map[string]any{
				"Title": "This link has expired",
				"Body":  "Connect links work once and last a week. Ask " + h.ownerDisplay() + " for a new one.",
			})
			return
		}
		if dc.GuildID() != "" {
			if err := dc.AddGuildMember(r.Context(), me.ID, tok.AccessToken); err != nil {
				h.log.Warn("discord add guild member", "err", err)
				h.render(w, http.StatusBadGateway, "message", map[string]any{"Title": "Almost", "Body": "Discord wouldn't add you to the server the bot messages from, so it can't DM you yet. Try the link again, or tell " + h.ownerDisplay() + "."})
				return
			}
		}
		if err := h.db.ConnectShareFriend(r.Context(), t.ID, me.ID, me.DisplayName()); err != nil {
			h.log.Error("connect share friend", "err", err)
			h.render(w, http.StatusInternalServerError, "message", map[string]any{"Title": "Something went wrong", "Body": "Try the link again in a minute."})
			return
		}
		h.setFriendCookie(w, me.ID)
		http.Redirect(w, r, "/s/?connected=1", http.StatusFound)
		return
	}

	h.setFriendCookie(w, me.ID)
	http.Redirect(w, r, "/s/", http.StatusFound)
}

func shareHost(raw string) string {
	s := strings.TrimPrefix(strings.TrimPrefix(raw, "https://"), "http://")
	s = strings.TrimPrefix(s, "www.")
	if i := strings.IndexByte(s, '/'); i >= 0 {
		s = s[:i]
	}
	return s
}

var publicTmpl = template.Must(template.New("").Funcs(template.FuncMap{
	"date": func(t time.Time) string { return t.Local().Format("Jan 2, 2006") },
	"host": shareHost,
	"dict": func(kv ...any) map[string]any {
		m := map[string]any{}
		for i := 0; i+1 < len(kv); i += 2 {
			m[kv[i].(string)] = kv[i+1]
		}
		return m
	},
	"lines": func(s string) []string {
		return strings.Split(s, "\n")
	},
}).Parse(publicPages))

const publicPages = `
{{define "head"}}<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>{{.Title}}</title>
<style>
:root{--paper:#f6f1e7;--ink:#2b2620;--muted:#7a6f62;--rule:#e2d8c6;--accent:#5865f2;--card:#fffdf8}
@media (prefers-color-scheme:dark){:root{--paper:#1c1a17;--ink:#ece6da;--muted:#a59a8b;--rule:#34302a;--card:#25221e}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:17px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;-webkit-text-size-adjust:100%}
main{max-width:640px;margin:0 auto;padding:max(28px,env(safe-area-inset-top)) 20px 48px}
h1{font:600 26px/1.25 Georgia,"Iowan Old Style",serif;margin:0 0 6px}
h2{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:32px 0 10px;font-weight:600}
p{margin:0 0 14px}
.muted{color:var(--muted)}
.btn{display:inline-flex;align-items:center;gap:10px;min-height:48px;padding:0 22px;border-radius:12px;background:var(--accent);color:#fff;text-decoration:none;font-weight:600;font-size:17px}
.note{background:#e7f0e1;color:#24401a;border-radius:10px;padding:12px 14px;margin:0 0 18px}
@media (prefers-color-scheme:dark){.note{background:#23311d;color:#cfe5c3}}
ul{list-style:none;margin:0;padding:0}
li{border-top:1px solid var(--rule)}
li:first-child{border-top:0}
a.item{display:flex;gap:14px;padding:14px 0;color:inherit;text-decoration:none;min-height:44px}
.thumb{flex:none;width:96px;height:64px;border-radius:8px;background:var(--rule) center/cover no-repeat}
.thumb.short{width:48px;height:80px}
.body{min-width:0}
.title{display:block;font:600 17px/1.3 Georgia,"Iowan Old Style",serif;margin:0 0 4px;overflow-wrap:anywhere}
.meta{display:block;font-size:14px;color:var(--muted)}
blockquote{margin:6px 0 0;padding:0 0 0 10px;border-left:3px solid var(--rule);font-size:15px}
footer{margin-top:40px;font-size:14px}
footer a{color:var(--muted)}
</style></head><body><main>{{end}}

{{define "foot"}}</main></body></html>{{end}}

{{define "message"}}{{template "head" .}}
<h1>{{.Title}}</h1>
<p class="muted">{{.Body}}</p>
{{template "foot" .}}{{end}}

{{define "signin"}}{{template "head" (dict "Title" "Shared with you")}}
<h1>Things {{.Owner}} shared with you</h1>
<p class="muted">Sign in with Discord to see everything {{.Owner}} has sent you.</p>
<p><a class="btn" href="/s/login">Sign in with Discord</a></p>
{{template "foot" .}}{{end}}

{{define "connect"}}{{template "head" (dict "Title" "Connect")}}
<h1>{{.Owner}} wants to share things with you</h1>
<p>Connect your Discord account and {{.Owner}}'s Otium bot will send you the videos and articles {{.Owner}} picks for you, as Discord messages.</p>
<p class="muted">Approving adds you to a Discord server the bot lives in, because Discord only lets bots message people they share a server with. The bot only sends; it can't read your messages.</p>
<p><a class="btn" href="{{.Go}}">Connect with Discord</a></p>
{{template "foot" .}}{{end}}

{{define "history"}}{{template "head" (dict "Title" "Shared with you")}}
<h1>Shared with you by {{.Owner}}</h1>
{{if .Connected}}<p class="note">You're connected. New shares will arrive as Discord messages from the Otium bot.</p>{{end}}
{{if not .Streams}}<p class="muted">Nothing yet. When {{.Owner}} shares something with you it will show up here too.</p>{{end}}
{{range .Streams}}
<h2>{{.Label}}</h2>
<ul>
{{range .Shares}}<li><a class="item" href="{{.URL}}" rel="noopener noreferrer">
{{if .ThumbnailURL}}<span class="thumb{{if eq .MediaType "short"}} short{{end}}" style="background-image:url('{{.ThumbnailURL}}')"></span>{{end}}
<span class="body"><span class="title">{{if .Title}}{{.Title}}{{else}}{{host .URL}}{{end}}</span>
<span class="meta">{{if .SourceName}}{{.SourceName}} · {{end}}{{date .CreatedAt}}</span>
{{if .Note}}<blockquote>{{range lines .Note}}{{.}}<br>{{end}}</blockquote>{{end}}</span></a></li>
{{end}}</ul>
{{end}}
<footer><a href="/s/logout">Sign out</a></footer>
{{template "foot" .}}{{end}}
`
