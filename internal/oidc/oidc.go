package oidc

import (
	"context"
	"fmt"
	"html"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	gooidc "github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

const (
	sessionCookie = "otium_session"
	flowCookie    = "otium_oidc_flow"
	retryCookie   = "otium_auth_retry"
	flowTTL       = 10 * time.Minute
	sessionTTL    = 30 * 24 * time.Hour
	// maxAuthRetry bounds the auto-restart of login when a callback arrives
	// without a valid in-flight flow (stale/bookmarked callback, expired flow).
	// After this many silent restarts we show a real page instead of looping.
	maxAuthRetry = 2
)

// Config is parsed from OTIUM_OIDC_* env in server config.
type Config struct {
	Issuer        string // public issuer, e.g. https://auth.fisher.sh (browser-facing + iss claim)
	InternalURL   string // in-cluster Hydra base for back-channel (token/jwks); avoids the CF hairpin
	ClientID      string
	ClientSecret  string
	RedirectURL   string
	Scopes        []string // default: openid profile email groups offline_access
	AllowedGroups []string // optional; if set, the user must be in one of these
	SessionSecret []byte
}

// Service is otium's OIDC client: the /auth/* handlers + session validation.
type Service struct {
	log           *slog.Logger
	verifier      *gooidc.IDTokenVerifier
	oauth2        oauth2.Config
	sessions      sessionStore
	secret        []byte
	allowedGroups map[string]struct{}
	secure        bool
}

// New builds the OIDC client WITHOUT discovery. Browser redirects use the public
// issuer (auth.fisher.sh); the token exchange + JWKS use the in-cluster Hydra URL
// so a server-to-server call never hairpins out to Cloudflare and back. The ID
// token's `iss` is still validated against the public issuer.
func New(ctx context.Context, cfg Config, log *slog.Logger) (*Service, error) {
	if cfg.Issuer == "" {
		return nil, fmt.Errorf("oidc: issuer is required")
	}
	issuer := strings.TrimRight(cfg.Issuer, "/")
	internal := strings.TrimRight(cfg.InternalURL, "/")
	if internal == "" {
		internal = issuer // fall back to the public URL (hairpins, but works)
	}
	scopes := cfg.Scopes
	if len(scopes) == 0 {
		scopes = []string{gooidc.ScopeOpenID, "profile", "email", "groups", gooidc.ScopeOfflineAccess}
	}
	allowed := map[string]struct{}{}
	for _, g := range cfg.AllowedGroups {
		if g = strings.TrimSpace(g); g != "" {
			allowed[g] = struct{}{}
		}
	}
	// JWKS fetched in-cluster; iss still validated as the public issuer.
	keySet := gooidc.NewRemoteKeySet(ctx, internal+"/.well-known/jwks.json")
	verifier := gooidc.NewVerifier(issuer, keySet, &gooidc.Config{ClientID: cfg.ClientID})

	log.Info("oidc enabled", "issuer", issuer, "internal", internal, "client_id", cfg.ClientID, "allowed_groups", cfg.AllowedGroups)
	return &Service{
		log:      log,
		verifier: verifier,
		oauth2: oauth2.Config{
			ClientID:     cfg.ClientID,
			ClientSecret: cfg.ClientSecret,
			Endpoint: oauth2.Endpoint{
				AuthURL:   issuer + "/oauth2/auth",    // browser-facing (public)
				TokenURL:  internal + "/oauth2/token", // back-channel (in-cluster)
				AuthStyle: oauth2.AuthStyleInHeader,   // client_secret_basic
			},
			RedirectURL: cfg.RedirectURL,
			Scopes:      scopes,
		},
		sessions:      newMemStore(),
		secret:        cfg.SessionSecret,
		allowedGroups: allowed,
		secure:        strings.HasPrefix(strings.ToLower(cfg.RedirectURL), "https://"),
	}, nil
}

// Current validates the session cookie and returns the identity, refreshing the
// access token if it has expired. Used by the auth middleware.
func (s *Service) Current(r *http.Request) (Identity, bool) {
	c, err := r.Cookie(sessionCookie)
	if err != nil {
		return Identity{}, false
	}
	sess, ok := s.sessions.get(c.Value)
	if !ok {
		return Identity{}, false
	}
	newTok, err := s.oauth2.TokenSource(r.Context(), sess.token).Token()
	if err != nil {
		s.log.Info("oidc session refresh failed, dropping", "sub", sess.identity.Subject, "err", err)
		s.sessions.delete(sess.id)
		return Identity{}, false
	}
	if newTok.AccessToken != sess.token.AccessToken {
		sess.token = newTok
		s.sessions.put(sess)
	}
	return sess.identity, true
}

// Login starts the Authorization Code + PKCE flow.
func (s *Service) Login(w http.ResponseWriter, r *http.Request) {
	state, err1 := randToken(24)
	nonce, err2 := randToken(24)
	if err1 != nil || err2 != nil {
		http.Error(w, "auth init failed", http.StatusInternalServerError)
		return
	}
	verifier := oauth2.GenerateVerifier()
	val, err := encodeFlowState(s.secret, flowState{
		State: state, Nonce: nonce, Verifier: verifier,
		Redirect: sanitizeRedirect(r.URL.Query().Get("rd")),
	})
	if err != nil {
		http.Error(w, "auth init failed", http.StatusInternalServerError)
		return
	}
	s.setCookie(w, flowCookie, val, flowTTL)
	http.Redirect(w, r, s.oauth2.AuthCodeURL(state, gooidc.Nonce(nonce), oauth2.S256ChallengeOption(verifier)), http.StatusFound)
}

// Callback completes the flow: exchange code, verify ID token, create session.
//
// Two failure classes are handled differently. A callback that arrives without a
// valid in-flight flow (no/expired flow cookie, bad state) means the user landed
// on a stale callback URL (bookmark, address-bar autocomplete) - not a real
// error, so we silently restart login (see recoverLogin) and they end up signed
// in. A callback that fails *after* a valid flow (exchange/verify/forbidden) is a
// genuine terminal error and gets a styled page, not a bare 400.
func (s *Service) Callback(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie(flowCookie)
	if err != nil {
		s.recoverLogin(w, r, "Your sign-in link expired.")
		return
	}
	s.clearCookie(w, flowCookie)
	fs, err := decodeFlowState(s.secret, c.Value)
	if err != nil {
		s.recoverLogin(w, r, "Your sign-in couldn't be verified.")
		return
	}
	if r.URL.Query().Get("state") != fs.State {
		s.recoverLogin(w, r, "Your sign-in link didn't match.")
		return
	}
	if e := r.URL.Query().Get("error"); e != "" {
		s.log.Info("idp returned error on callback", "error", e)
		s.renderAuthError(w, http.StatusUnauthorized, "Sign-in was cancelled or didn't complete.", true)
		return
	}
	tok, err := s.oauth2.Exchange(r.Context(), r.URL.Query().Get("code"), oauth2.VerifierOption(fs.Verifier))
	if err != nil {
		s.log.Warn("code exchange failed", "err", err)
		s.renderAuthError(w, http.StatusBadGateway, "We couldn't complete sign-in. Please try again.", true)
		return
	}
	rawID, ok := tok.Extra("id_token").(string)
	if !ok {
		s.renderAuthError(w, http.StatusBadGateway, "We couldn't complete sign-in. Please try again.", true)
		return
	}
	idToken, err := s.verifier.Verify(r.Context(), rawID)
	if err != nil {
		s.renderAuthError(w, http.StatusUnauthorized, "We couldn't verify your sign-in. Please try again.", true)
		return
	}
	if idToken.Nonce != fs.Nonce {
		s.renderAuthError(w, http.StatusUnauthorized, "We couldn't verify your sign-in. Please try again.", true)
		return
	}
	id, err := identityFromToken(idToken)
	if err != nil {
		s.renderAuthError(w, http.StatusBadGateway, "We couldn't read your account details. Please try again.", true)
		return
	}
	if !s.groupAllowed(id) {
		s.log.Info("oidc login denied: group not permitted", "sub", id.Subject, "groups", id.Groups)
		s.renderAuthError(w, http.StatusForbidden, "Your account isn't permitted to use this app.", false)
		return
	}
	sid, err := randToken(24)
	if err != nil {
		s.renderAuthError(w, http.StatusInternalServerError, "Something went wrong starting your session. Please try again.", true)
		return
	}
	s.sessions.put(&session{id: sid, identity: id, token: tok, expiry: time.Now().Add(sessionTTL)})
	s.setCookie(w, sessionCookie, sid, sessionTTL)
	s.clearCookie(w, retryCookie) // a real login resets the loop guard
	s.log.Info("oidc login ok", "sub", id.Subject)
	http.Redirect(w, r, fs.Redirect, http.StatusFound)
}

// recoverLogin restarts the OIDC flow after a callback with no valid in-flight
// login (stale/bookmarked callback URL, or an expired 10-min flow). A retry
// counter cookie bounds the auto-restart so a persistent failure (e.g. the
// browser is blocking cookies) shows a real page instead of an infinite loop.
func (s *Service) recoverLogin(w http.ResponseWriter, r *http.Request, reason string) {
	n := 0
	if c, err := r.Cookie(retryCookie); err == nil {
		n, _ = strconv.Atoi(c.Value)
	}
	if n >= maxAuthRetry {
		s.clearCookie(w, retryCookie)
		s.log.Info("auth auto-recover exhausted, showing error", "attempts", n)
		s.renderAuthError(w, http.StatusBadRequest,
			reason+" We tried to sign you in automatically but couldn't - this usually means cookies are being blocked. Tap below to try again, or open the app in a fresh tab.", true)
		return
	}
	s.setCookie(w, retryCookie, strconv.Itoa(n+1), flowTTL)
	http.Redirect(w, r, "/auth/login", http.StatusFound)
}

// renderAuthError writes a small styled page (otium aesthetic) for genuine auth
// failures, with an optional "Sign in" button. message is escaped.
func (s *Service) renderAuthError(w http.ResponseWriter, status int, message string, showRetry bool) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	btn := ""
	if showRetry {
		btn = `<a class="btn" href="/auth/login">Sign in</a>`
	}
	fmt.Fprintf(w, authErrorPage, html.EscapeString(message), btn)
}

// authErrorPage is a self-contained, on-brand error page. %s = message, %s = button.
const authErrorPage = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>otium</title>
<style>html,body{margin:0;height:100%%}body{display:flex;align-items:center;justify-content:center;
background:#f4f0e8;color:#1c1813;font-family:Georgia,"Times New Roman",serif;padding:24px}
.box{max-width:340px;text-align:center}.mark{font-size:30px;letter-spacing:.02em;margin:0 0 14px}
p{color:#5f574b;font-size:16px;line-height:1.55;margin:0}
.btn{display:inline-block;margin-top:22px;background:#1c1813;color:#f4f0e8;text-decoration:none;
padding:12px 26px;border-radius:7px;font-family:ui-monospace,monospace;font-size:13px;letter-spacing:.05em}
@media(prefers-color-scheme:dark){body{background:#17140f;color:#ece5d8}p{color:#a89e90}.btn{background:#ece5d8;color:#17140f}}
</style></head><body><div class="box"><div class="mark">otium</div><p>%s</p>%s</div></body></html>`

// Logout clears the session and returns to the app root.
func (s *Service) Logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		s.sessions.delete(c.Value)
	}
	s.clearCookie(w, sessionCookie)
	http.Redirect(w, r, "/", http.StatusFound)
}

func identityFromToken(idToken *gooidc.IDToken) (Identity, error) {
	var c struct {
		Sub    string   `json:"sub"`
		Email  string   `json:"email"`
		Name   string   `json:"name"`
		Groups []string `json:"groups"`
	}
	if err := idToken.Claims(&c); err != nil {
		return Identity{}, err
	}
	// The login app puts email/name/groups in the ID token, so no UserInfo
	// round-trip is needed.
	return Identity{Subject: c.Sub, Email: c.Email, Name: c.Name, Groups: c.Groups}, nil
}

func (s *Service) groupAllowed(id Identity) bool {
	if len(s.allowedGroups) == 0 {
		return true
	}
	for _, g := range id.Groups {
		if _, ok := s.allowedGroups[g]; ok {
			return true
		}
	}
	return false
}

func (s *Service) setCookie(w http.ResponseWriter, name, value string, ttl time.Duration) {
	http.SetCookie(w, &http.Cookie{
		Name: name, Value: value, Path: "/", MaxAge: int(ttl.Seconds()),
		HttpOnly: true, Secure: s.secure, SameSite: http.SameSiteLaxMode,
	})
}

func (s *Service) clearCookie(w http.ResponseWriter, name string) {
	http.SetCookie(w, &http.Cookie{
		Name: name, Value: "", Path: "/", MaxAge: -1,
		HttpOnly: true, Secure: s.secure, SameSite: http.SameSiteLaxMode,
	})
}

func sanitizeRedirect(rd string) string {
	if rd == "" || !strings.HasPrefix(rd, "/") || strings.HasPrefix(rd, "//") {
		return "/"
	}
	return rd
}
