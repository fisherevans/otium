// Package discord is the small slice of the Discord REST API otium uses to share
// items (#195): a bot that DMs friends and posts to channels, and the OAuth2 code
// flow a friend goes through once to connect (identify + guilds.join).
//
// It is plain net/http against API v10, no gateway connection: the bot never
// listens, it only sends. A Client is safe for concurrent use. A nil *Client means
// sharing is not configured; callers check with Enabled.
package discord

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const apiBase = "https://discord.com/api/v10"

// BotPermissions is what the bot asks for when it is added to a server: View
// Channels, Send Messages, Embed Links (so links unfurl), Create Instant Invite
// (required for guilds.join to add a friend to the share server).
const BotPermissions = 1024 | 2048 | 16384 | 1

type Config struct {
	ClientID     string
	ClientSecret string
	BotToken     string
	// RedirectURL is the public OAuth callback, e.g. https://share.fisher.sh/s/callback.
	RedirectURL string
	// GuildID is the server a connecting friend is added to, so the bot shares a
	// server with them and may DM them.
	GuildID string
	// APIBase overrides the API root; empty means Discord. Only for local fakes.
	APIBase string
}

type Client struct {
	cfg  Config
	http *http.Client
	base string
}

func New(cfg Config) *Client {
	base := apiBase
	if cfg.APIBase != "" {
		base = strings.TrimRight(cfg.APIBase, "/")
	}
	return &Client{cfg: cfg, http: &http.Client{Timeout: 15 * time.Second}, base: base}
}

func (c *Client) Enabled() bool { return c != nil && c.cfg.BotToken != "" && c.cfg.ClientID != "" }

func (c *Client) GuildID() string { return c.cfg.GuildID }

// InviteURL adds the bot to a server Fisher picks. Only he can use it (the bot is
// not public).
func (c *Client) InviteURL() string {
	q := url.Values{
		"client_id":   {c.cfg.ClientID},
		"scope":       {"bot"},
		"permissions": {fmt.Sprint(BotPermissions)},
	}
	return "https://discord.com/oauth2/authorize?" + q.Encode()
}

// AuthorizeURL is where a friend is sent to approve the app. joinGuild asks for
// guilds.join too, which the first connect needs and a later history sign-in does
// not.
func (c *Client) AuthorizeURL(state string, joinGuild bool) string {
	scope := "identify"
	if joinGuild {
		scope += " guilds.join"
	}
	q := url.Values{
		"client_id":     {c.cfg.ClientID},
		"response_type": {"code"},
		"redirect_uri":  {c.cfg.RedirectURL},
		"scope":         {scope},
		"state":         {state},
		"prompt":        {"none"},
	}
	return "https://discord.com/oauth2/authorize?" + q.Encode()
}

// APIError is a non-2xx answer from Discord. Code is Discord's JSON error code
// when present (50007 = cannot DM this user, 10003 = unknown channel, ...).
type APIError struct {
	Status  int
	Code    int
	Message string
}

func (e *APIError) Error() string {
	if e.Message != "" {
		return fmt.Sprintf("discord %d: %s", e.Status, e.Message)
	}
	return fmt.Sprintf("discord http %d", e.Status)
}

type User struct {
	ID         string `json:"id"`
	Username   string `json:"username"`
	GlobalName string `json:"global_name"`
	Avatar     string `json:"avatar"`
}

// DisplayName is what Discord shows for the user: the global display name, else
// the username.
func (u User) DisplayName() string {
	if u.GlobalName != "" {
		return u.GlobalName
	}
	return u.Username
}

type Guild struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type Channel struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Type     int    `json:"type"`
	Position int    `json:"position"`
	ParentID string `json:"parent_id"`
}

// Postable reports whether a guild channel takes plain messages: text (0) and
// announcement (5) channels.
func (ch Channel) Postable() bool { return ch.Type == 0 || ch.Type == 5 }

type Message struct {
	ID        string `json:"id"`
	ChannelID string `json:"channel_id"`
}

// Token is the user's OAuth2 access token from the code exchange.
type Token struct {
	AccessToken string `json:"access_token"`
	Scope       string `json:"scope"`
}

// ExchangeCode trades an authorization code for the friend's access token.
func (c *Client) ExchangeCode(ctx context.Context, code string) (*Token, error) {
	form := url.Values{
		"grant_type":   {"authorization_code"},
		"code":         {code},
		"redirect_uri": {c.cfg.RedirectURL},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+"/oauth2/token", strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth(c.cfg.ClientID, c.cfg.ClientSecret)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	var tok Token
	if err := c.do(req, &tok); err != nil {
		return nil, err
	}
	return &tok, nil
}

// Me is the user behind a friend's access token.
func (c *Client) Me(ctx context.Context, accessToken string) (*User, error) {
	var u User
	if err := c.call(ctx, http.MethodGet, "/users/@me", "Bearer "+accessToken, nil, &u); err != nil {
		return nil, err
	}
	return &u, nil
}

// AddGuildMember adds the friend to the share server using their guilds.join
// token. Already being a member is not an error (Discord answers 204).
func (c *Client) AddGuildMember(ctx context.Context, userID, accessToken string) error {
	body := map[string]string{"access_token": accessToken}
	return c.call(ctx, http.MethodPut, "/guilds/"+c.cfg.GuildID+"/members/"+userID, c.bot(), body, nil)
}

// OpenDM returns the DM channel between the bot and a user.
func (c *Client) OpenDM(ctx context.Context, userID string) (string, error) {
	var ch Channel
	if err := c.call(ctx, http.MethodPost, "/users/@me/channels", c.bot(), map[string]string{"recipient_id": userID}, &ch); err != nil {
		return "", err
	}
	return ch.ID, nil
}

// Send posts plain content to a channel. Mentions are never parsed, so a note
// cannot ping anyone.
func (c *Client) Send(ctx context.Context, channelID, content string) (*Message, error) {
	body := map[string]any{
		"content":          content,
		"allowed_mentions": map[string]any{"parse": []string{}},
	}
	var m Message
	if err := c.call(ctx, http.MethodPost, "/channels/"+channelID+"/messages", c.bot(), body, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

// BotGuilds lists the servers the bot has been added to.
func (c *Client) BotGuilds(ctx context.Context) ([]Guild, error) {
	var gs []Guild
	err := c.call(ctx, http.MethodGet, "/users/@me/guilds", c.bot(), nil, &gs)
	return gs, err
}

// GuildChannels lists a server's channels (every type; filter with Postable).
func (c *Client) GuildChannels(ctx context.Context, guildID string) ([]Channel, error) {
	var chs []Channel
	err := c.call(ctx, http.MethodGet, "/guilds/"+guildID+"/channels", c.bot(), nil, &chs)
	return chs, err
}

func (c *Client) bot() string { return "Bot " + c.cfg.BotToken }

func (c *Client) call(ctx context.Context, method, path, auth string, body, out any) error {
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, rd)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", auth)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return c.do(req, out)
}

func (c *Client) do(req *http.Request, out any) error {
	req.Header.Set("User-Agent", "DiscordBot (https://github.com/fisherevans/otium, 1)")
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 300 {
		e := &APIError{Status: resp.StatusCode}
		var payload struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
			Error   string `json:"error_description"`
		}
		if json.Unmarshal(raw, &payload) == nil {
			e.Code = payload.Code
			e.Message = payload.Message
			if e.Message == "" {
				e.Message = payload.Error
			}
		}
		return e
	}
	if out != nil && len(raw) > 0 {
		return json.Unmarshal(raw, out)
	}
	return nil
}
