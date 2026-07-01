package oidc

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	gooidc "github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

const (
	sessionCookie = "otium_session"
	flowCookie    = "otium_oidc_flow"
	flowTTL       = 10 * time.Minute
	sessionTTL    = 30 * 24 * time.Hour
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
func (s *Service) Callback(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie(flowCookie)
	if err != nil {
		http.Error(w, "login expired, try again", http.StatusBadRequest)
		return
	}
	s.clearCookie(w, flowCookie)
	fs, err := decodeFlowState(s.secret, c.Value)
	if err != nil {
		http.Error(w, "invalid login state", http.StatusBadRequest)
		return
	}
	if r.URL.Query().Get("state") != fs.State {
		http.Error(w, "state mismatch", http.StatusBadRequest)
		return
	}
	if e := r.URL.Query().Get("error"); e != "" {
		http.Error(w, "identity provider error: "+e, http.StatusUnauthorized)
		return
	}
	tok, err := s.oauth2.Exchange(r.Context(), r.URL.Query().Get("code"), oauth2.VerifierOption(fs.Verifier))
	if err != nil {
		s.log.Warn("code exchange failed", "err", err)
		http.Error(w, "token exchange failed", http.StatusBadGateway)
		return
	}
	rawID, ok := tok.Extra("id_token").(string)
	if !ok {
		http.Error(w, "no id_token", http.StatusBadGateway)
		return
	}
	idToken, err := s.verifier.Verify(r.Context(), rawID)
	if err != nil {
		http.Error(w, "id_token verification failed", http.StatusUnauthorized)
		return
	}
	if idToken.Nonce != fs.Nonce {
		http.Error(w, "nonce mismatch", http.StatusUnauthorized)
		return
	}
	id, err := identityFromToken(idToken)
	if err != nil {
		http.Error(w, "could not resolve identity", http.StatusBadGateway)
		return
	}
	if !s.groupAllowed(id) {
		s.log.Info("oidc login denied: group not permitted", "sub", id.Subject, "groups", id.Groups)
		http.Error(w, "forbidden: your account is not permitted to use this app", http.StatusForbidden)
		return
	}
	sid, err := randToken(24)
	if err != nil {
		http.Error(w, "session init failed", http.StatusInternalServerError)
		return
	}
	s.sessions.put(&session{id: sid, identity: id, token: tok, expiry: time.Now().Add(sessionTTL)})
	s.setCookie(w, sessionCookie, sid, sessionTTL)
	s.log.Info("oidc login ok", "sub", id.Subject)
	http.Redirect(w, r, fs.Redirect, http.StatusFound)
}

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
