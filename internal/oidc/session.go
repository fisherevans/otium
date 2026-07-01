// Package oidc makes otium a confidential OpenID Connect client of
// auth.fisher.sh (Ory Hydra). The browser auth path (login -> IdP -> session
// cookie) lives here. Sessions are in-memory: otium-server keeps durable state
// in SQLite, so a restart just triggers a silent re-auth via the IdP's
// long-lived SSO "remember" - not a password prompt. In-memory sessions also
// mean otium-server must run a single replica (fine for a homelab app).
//
// Adapted from bloom's OIDC client; the flow is identical, only the cookie
// names and env prefix differ.
package oidc

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"time"

	"golang.org/x/oauth2"
)

// Identity is the authenticated user resolved from the IdP's ID token.
type Identity struct {
	Subject string
	Email   string
	Name    string
	Groups  []string
}

type session struct {
	id       string
	identity Identity
	token    *oauth2.Token
	expiry   time.Time
}

type sessionStore interface {
	get(id string) (*session, bool)
	put(s *session)
	delete(id string)
}

type memStore struct {
	mu sync.Mutex
	m  map[string]*session
}

func newMemStore() *memStore { return &memStore{m: make(map[string]*session)} }

func (s *memStore) get(id string) (*session, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, ok := s.m[id]
	if !ok {
		return nil, false
	}
	if time.Now().After(sess.expiry) {
		delete(s.m, id)
		return nil, false
	}
	return sess, true
}

func (s *memStore) put(sess *session) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.m[sess.id] = sess
}

func (s *memStore) delete(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.m, id)
}

func randToken(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// flowState is the transient per-login data parked in a signed cookie between
// /auth/login and /auth/callback.
type flowState struct {
	State    string `json:"s"`
	Nonce    string `json:"n"`
	Verifier string `json:"v"`
	Redirect string `json:"r"`
}

func signValue(secret, payload []byte) string {
	mac := hmac.New(sha256.New, secret)
	mac.Write(payload)
	return base64.RawURLEncoding.EncodeToString(payload) + "." +
		base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func verifyValue(secret []byte, value string) ([]byte, error) {
	dot := strings.LastIndex(value, ".")
	if dot < 0 {
		return nil, errors.New("malformed signed value")
	}
	payload, err := base64.RawURLEncoding.DecodeString(value[:dot])
	if err != nil {
		return nil, err
	}
	sig, err := base64.RawURLEncoding.DecodeString(value[dot+1:])
	if err != nil {
		return nil, err
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write(payload)
	if !hmac.Equal(sig, mac.Sum(nil)) {
		return nil, errors.New("bad signature")
	}
	return payload, nil
}

func encodeFlowState(secret []byte, fs flowState) (string, error) {
	b, err := json.Marshal(fs)
	if err != nil {
		return "", err
	}
	return signValue(secret, b), nil
}

func decodeFlowState(secret []byte, value string) (flowState, error) {
	var fs flowState
	payload, err := verifyValue(secret, value)
	if err != nil {
		return fs, err
	}
	err = json.Unmarshal(payload, &fs)
	return fs, err
}
