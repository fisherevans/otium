// Package middleware provides HTTP middleware for the otium web server.
package middleware

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/fisherevans/otium/internal/server/store"
)

type contextKey string

const identityKey contextKey = "identity"

// Identity is the authenticated user for a request.
type Identity struct {
	UserID   int64
	Username string
	Email    string
	Name     string
	Groups   string
}

// SessionResolver returns the Identity for an authenticated OIDC browser
// session, or (nil, nil) when there is no valid session. It owns the
// UpsertUserByUsername bridge so the returned Identity has a real UserID.
type SessionResolver func(r *http.Request) (*Identity, error)

// RequireAuth gates a request on a valid OIDC session cookie. otium is
// browser-only for now; if programmatic API keys are added later, this is where
// a bearer-token path slots in (see bloom's middleware for that shape).
func RequireAuth(resolveSession SessionResolver) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if resolveSession != nil {
				identity, err := resolveSession(r)
				if err != nil {
					slog.Error("resolve session failed", "err", err)
					jsonError(w, http.StatusInternalServerError, "server_error", "could not resolve session")
					return
				}
				if identity != nil {
					next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), identityKey, identity)))
					return
				}
			}
			jsonError(w, http.StatusUnauthorized, "unauthorized", "missing authentication")
		})
	}
}

// DevAuth is a local-dev-only replacement for RequireAuth. It upserts the given
// username and injects the identity on every request. Never use in production.
func DevAuth(db *store.DB, username string) func(http.Handler) http.Handler {
	email := username + "@dev.local"
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user, err := db.UpsertUserByUsername(r.Context(), username, email)
			if err != nil {
				jsonError(w, http.StatusInternalServerError, "server_error", "could not resolve dev user")
				return
			}
			identity := &Identity{UserID: user.ID, Username: username, Email: email}
			ctx := context.WithValue(r.Context(), identityKey, identity)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// IdentityFrom extracts the Identity from the request context. Returns nil if
// not present (should not happen after RequireAuth/DevAuth).
func IdentityFrom(ctx context.Context) *Identity {
	v, _ := ctx.Value(identityKey).(*Identity)
	return v
}

func jsonError(w http.ResponseWriter, status int, code, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(`{"code":"` + code + `","message":"` + msg + `"}`))
}
