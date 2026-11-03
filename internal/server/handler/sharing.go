package handler

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/fisherevans/otium/internal/server/discord"
	"github.com/fisherevans/otium/internal/server/middleware"
	"github.com/fisherevans/otium/internal/server/store"
	"github.com/go-chi/chi/v5"
)

// connectTTL is how long a friend's connect link stays usable.
const connectTTL = 7 * 24 * time.Hour

// SharingConfig wires Discord sharing (#195). A nil Discord client, or one
// without a bot token, leaves every sharing endpoint answering 503.
type SharingConfig struct {
	Discord *discord.Client
	// PublicBaseURL is the public host the friend-facing /s/* routes live on,
	// e.g. https://share.fisher.sh.
	PublicBaseURL string
	// OwnerName is how shares are signed ("Fisher shared ..."). Empty falls back
	// to the user's name.
	OwnerName string
	// Secret signs OAuth state and the friend's history cookie.
	Secret []byte
}

func (h *Handler) SetSharing(c SharingConfig) {
	c.PublicBaseURL = strings.TrimRight(c.PublicBaseURL, "/")
	h.share = c
}

func (h *Handler) sharingOn() bool { return h.share.Discord.Enabled() && h.share.PublicBaseURL != "" }

func (h *Handler) sharingOff(w http.ResponseWriter) bool {
	if h.sharingOn() {
		return false
	}
	writeJSON(w, http.StatusServiceUnavailable, map[string]any{"code": "unavailable", "message": "Discord sharing is not configured"})
	return true
}

type shareTargetJSON struct {
	store.ShareTarget
	ConnectURL string `json:"connect_url,omitempty"`
}

func (h *Handler) targetJSON(t store.ShareTarget) shareTargetJSON {
	out := shareTargetJSON{ShareTarget: t}
	if t.Kind == store.ShareKindFriend && t.ConnectToken != "" && time.Now().Before(t.ConnectExpiresAt) {
		out.ConnectURL = h.share.PublicBaseURL + "/s/c/" + t.ConnectToken
	}
	return out
}

// ShareStatus tells the UI whether sharing is available and how to add the bot
// to another server.
func (h *Handler) ShareStatus(w http.ResponseWriter, r *http.Request) {
	if !h.sharingOn() {
		writeJSON(w, http.StatusOK, map[string]any{"available": false})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"available":   true,
		"invite_url":  h.share.Discord.InviteURL(),
		"history_url": h.share.PublicBaseURL + "/s/",
	})
}

func (h *Handler) ListShareTargets(w http.ResponseWriter, r *http.Request) {
	ts, err := h.db.ListShareTargets(r.Context(), userID(r))
	if err != nil {
		serverError(w, h.log, "list share targets", err)
		return
	}
	out := make([]shareTargetJSON, len(ts))
	for i, t := range ts {
		out[i] = h.targetJSON(t)
	}
	writeJSON(w, http.StatusOK, out)
}

func newConnectToken() string {
	b := make([]byte, 18)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func cleanNickname(s string) string {
	s = strings.TrimSpace(s)
	if len(s) > 60 {
		s = s[:60]
	}
	return s
}

// CreateShareFriend adds a friend by nickname and returns their connect link.
func (h *Handler) CreateShareFriend(w http.ResponseWriter, r *http.Request) {
	if h.sharingOff(w) {
		return
	}
	var body struct {
		Nickname string `json:"nickname"`
	}
	if !decode(w, r, &body) {
		return
	}
	nick := cleanNickname(body.Nickname)
	if nick == "" {
		badRequest(w, "nickname is required")
		return
	}
	t, err := h.db.CreateShareFriend(r.Context(), userID(r), nick, newConnectToken(), time.Now().Add(connectTTL))
	if err != nil {
		serverError(w, h.log, "create share friend", err)
		return
	}
	writeJSON(w, http.StatusCreated, h.targetJSON(*t))
}

// NewShareConnectLink mints a fresh connect link for a friend.
func (h *Handler) NewShareConnectLink(w http.ResponseWriter, r *http.Request) {
	if h.sharingOff(w) {
		return
	}
	uid := userID(r)
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err := h.db.SetShareConnectToken(r.Context(), uid, id, newConnectToken(), time.Now().Add(connectTTL)); err != nil {
		serverError(w, h.log, "new connect link", err)
		return
	}
	h.writeTarget(w, r, uid, id)
}

func (h *Handler) writeTarget(w http.ResponseWriter, r *http.Request, uid, id int64) {
	t, err := h.db.GetShareTarget(r.Context(), uid, id)
	if err != nil {
		serverError(w, h.log, "get share target", err)
		return
	}
	if t == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"code": "not_found", "message": "share target not found"})
		return
	}
	writeJSON(w, http.StatusOK, h.targetJSON(*t))
}

func (h *Handler) RenameShareTarget(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	var body struct {
		Nickname string `json:"nickname"`
	}
	if !decode(w, r, &body) {
		return
	}
	nick := cleanNickname(body.Nickname)
	if nick == "" {
		badRequest(w, "nickname is required")
		return
	}
	if err := h.db.RenameShareTarget(r.Context(), uid, id, nick); err != nil {
		serverError(w, h.log, "rename share target", err)
		return
	}
	h.writeTarget(w, r, uid, id)
}

func (h *Handler) DeleteShareTarget(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err := h.db.DeleteShareTarget(r.Context(), userID(r), id); err != nil {
		serverError(w, h.log, "delete share target", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

type discordGuildJSON struct {
	ID       string               `json:"id"`
	Name     string               `json:"name"`
	Channels []discordChannelJSON `json:"channels"`
}

type discordChannelJSON struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Category string `json:"category,omitempty"`
}

// DiscordChannels lists every server the bot is in with the channels it could
// post to, for the add-channel picker.
func (h *Handler) DiscordChannels(w http.ResponseWriter, r *http.Request) {
	if h.sharingOff(w) {
		return
	}
	dc := h.share.Discord
	guilds, err := dc.BotGuilds(r.Context())
	if err != nil {
		h.log.Error("discord guilds failed", "err", err)
		writeJSON(w, http.StatusBadGateway, map[string]any{"code": "discord", "message": "Couldn't reach Discord: " + err.Error()})
		return
	}
	out := []discordGuildJSON{}
	for _, g := range guilds {
		chs, err := dc.GuildChannels(r.Context(), g.ID)
		if err != nil {
			h.log.Warn("discord channels failed", "guild", g.ID, "err", err)
			continue
		}
		cats := map[string]string{}
		for _, c := range chs {
			if c.Type == 4 {
				cats[c.ID] = c.Name
			}
		}
		sort.SliceStable(chs, func(i, j int) bool { return chs[i].Position < chs[j].Position })
		gj := discordGuildJSON{ID: g.ID, Name: g.Name, Channels: []discordChannelJSON{}}
		for _, c := range chs {
			if c.Postable() {
				gj.Channels = append(gj.Channels, discordChannelJSON{ID: c.ID, Name: c.Name, Category: cats[c.ParentID]})
			}
		}
		out = append(out, gj)
	}
	writeJSON(w, http.StatusOK, out)
}

// CreateShareChannel adds a server channel as a share target.
func (h *Handler) CreateShareChannel(w http.ResponseWriter, r *http.Request) {
	if h.sharingOff(w) {
		return
	}
	var body struct {
		Nickname    string `json:"nickname"`
		GuildID     string `json:"guild_id"`
		GuildName   string `json:"guild_name"`
		ChannelID   string `json:"channel_id"`
		ChannelName string `json:"channel_name"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.GuildID == "" || body.ChannelID == "" {
		badRequest(w, "guild_id and channel_id are required")
		return
	}
	nick := cleanNickname(body.Nickname)
	if nick == "" {
		nick = "#" + body.ChannelName
	}
	t, err := h.db.CreateShareChannel(r.Context(), userID(r), nick, body.GuildID, body.GuildName, body.ChannelID, body.ChannelName)
	if err != nil {
		serverError(w, h.log, "create share channel", err)
		return
	}
	writeJSON(w, http.StatusCreated, h.targetJSON(*t))
}

type shareResult struct {
	TargetID int64  `json:"target_id"`
	Nickname string `json:"nickname"`
	OK       bool   `json:"ok"`
	Error    string `json:"error,omitempty"`
}

// ShareItem sends an item to one or more targets. Each target succeeds or fails
// on its own; the response says which.
func (h *Handler) ShareItem(w http.ResponseWriter, r *http.Request) {
	if h.sharingOff(w) {
		return
	}
	uid := userID(r)
	itemID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		badRequest(w, "bad item id")
		return
	}
	var body struct {
		TargetIDs []int64 `json:"target_ids"`
		Note      string  `json:"note"`
	}
	if !decode(w, r, &body) {
		return
	}
	if len(body.TargetIDs) == 0 {
		badRequest(w, "pick at least one friend or channel")
		return
	}
	note := strings.TrimSpace(body.Note)
	if len(note) > 1000 {
		note = note[:1000]
	}
	it, err := h.db.GetItem(r.Context(), uid, itemID)
	if err != nil {
		serverError(w, h.log, "get item", err)
		return
	}
	if it == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"code": "not_found", "message": "item not found"})
		return
	}

	var targets []store.ShareTarget
	var friendIDs []int64
	seen := map[int64]bool{}
	for _, id := range body.TargetIDs {
		if seen[id] {
			continue
		}
		seen[id] = true
		t, err := h.db.GetShareTarget(r.Context(), uid, id)
		if err != nil {
			serverError(w, h.log, "get share target", err)
			return
		}
		if t == nil {
			badRequest(w, "unknown share target "+strconv.FormatInt(id, 10))
			return
		}
		targets = append(targets, *t)
		if t.Kind == store.ShareKindFriend {
			friendIDs = append(friendIDs, t.ID)
		}
	}

	link := ShareURL(it.URL)
	sh := &store.Share{
		ItemID: it.ID, URL: link, Title: it.Headline(140), SourceName: h.db.ShareSourceName(r.Context(), it.SourceID),
		ThumbnailURL: it.ThumbnailURL, MediaType: it.MediaType, Note: note, StreamKey: store.StreamKey(friendIDs),
	}
	shareID, err := h.db.CreateShare(r.Context(), uid, sh)
	if err != nil {
		serverError(w, h.log, "create share", err)
		return
	}
	owner := h.share.OwnerName
	if owner == "" {
		id := middleware.IdentityFrom(r.Context())
		owner = id.Name
		if owner == "" {
			owner = id.Username
		}
	}

	results := make([]shareResult, 0, len(targets))
	for _, t := range targets {
		msg := ShareMessage(owner, link, note, h.share.PublicBaseURL+"/s/", t.Kind == store.ShareKindFriend)
		msgID, sendErr := h.deliver(r.Context(), t, msg)
		res := shareResult{TargetID: t.ID, Nickname: t.Nickname, OK: sendErr == ""}
		res.Error = sendErr
		if err := h.db.RecordShareDelivery(r.Context(), shareID, t.ID, msgID, sendErr); err != nil {
			h.log.Error("record share delivery", "err", err)
		}
		if t.Status != store.ShareStatusPending {
			_ = h.db.SetShareTargetHealth(r.Context(), t.ID, sendErr)
		}
		results = append(results, res)
	}
	iid := it.ID
	_ = h.db.LogEvent(r.Context(), uid, "share", &iid, &it.SourceID, "", "")
	writeJSON(w, http.StatusOK, map[string]any{"share_id": shareID, "results": results})
}

// deliver sends one message and returns the Discord message id, or a
// human-readable reason it could not be sent.
func (h *Handler) deliver(ctx context.Context, t store.ShareTarget, msg string) (string, string) {
	dc := h.share.Discord
	if t.Kind == store.ShareKindFriend {
		if t.DiscordUserID == "" {
			return "", "They haven't connected yet. Send them their connect link."
		}
		for attempt := 0; attempt < 2; attempt++ {
			ch := t.ChannelID
			if ch == "" {
				opened, err := dc.OpenDM(ctx, t.DiscordUserID)
				if err != nil {
					return "", sendError(err, true)
				}
				ch = opened
				_ = h.db.SetShareTargetDM(ctx, t.ID, ch)
			}
			m, err := dc.Send(ctx, ch, msg)
			var ae *discord.APIError
			if err != nil && errors.As(err, &ae) && ae.Code == 10003 && t.ChannelID != "" {
				t.ChannelID = "" // the cached DM channel is gone; open a new one once
				continue
			}
			if err != nil {
				return "", sendError(err, true)
			}
			return m.ID, ""
		}
	}
	m, err := dc.Send(ctx, t.ChannelID, msg)
	if err != nil {
		return "", sendError(err, false)
	}
	return m.ID, ""
}

func sendError(err error, friend bool) string {
	var ae *discord.APIError
	if errors.As(err, &ae) {
		switch ae.Code {
		case 50007:
			return "Discord won't let the bot message them. They may have left the server or turned off DMs from server members."
		case 50001, 50013:
			return "The bot can't post there. Check its permissions in that channel."
		case 10003:
			return "That channel no longer exists."
		case 10013:
			return "That Discord account no longer exists."
		}
		if ae.Status == http.StatusTooManyRequests {
			return "Discord is rate limiting the bot. Try again in a minute."
		}
		return ae.Error()
	}
	return "Couldn't reach Discord: " + err.Error()
}

// ShareURL is the link that goes into Discord. YouTube Shorts links are
// rewritten to the watch form, which Discord unfurls as an inline player.
func ShareURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	host := strings.TrimPrefix(strings.ToLower(u.Host), "www.")
	host = strings.TrimPrefix(host, "m.")
	if host == "youtube.com" && strings.HasPrefix(u.Path, "/shorts/") {
		id := strings.Trim(strings.TrimPrefix(u.Path, "/shorts/"), "/")
		if id != "" {
			return "https://www.youtube.com/watch?v=" + id
		}
	}
	return raw
}

// ShareMessage is the Discord message body. The shared link is the only bare URL,
// so it is the one Discord unfurls; the history link is wrapped in <> to stop it
// unfurling too. Notes are quoted line by line.
func ShareMessage(owner, link, note, historyURL string, friend bool) string {
	var b strings.Builder
	b.WriteString("**" + escapeMarkdown(owner) + "** shared:\n")
	if note != "" {
		for _, line := range strings.Split(note, "\n") {
			b.WriteString("> " + line + "\n")
		}
	}
	b.WriteString(link)
	if friend && historyURL != "" {
		b.WriteString("\n-# Everything " + escapeMarkdown(owner) + " has sent you: <" + historyURL + ">")
	}
	return b.String()
}

func escapeMarkdown(s string) string {
	r := strings.NewReplacer("*", `\*`, "_", `\_`, "~", `\~`, "`", "\\`", "|", `\|`, ">", `\>`)
	return r.Replace(s)
}

// ListShares is the owner's own sent log, optionally for one target.
func (h *Handler) ListShares(w http.ResponseWriter, r *http.Request) {
	targetID, _ := strconv.ParseInt(r.URL.Query().Get("target_id"), 10, 64)
	limit := intParam(r, "limit", 100)
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	shares, err := h.db.ListShares(r.Context(), userID(r), targetID, limit)
	if err != nil {
		serverError(w, h.log, "list shares", err)
		return
	}
	writeJSON(w, http.StatusOK, shares)
}
