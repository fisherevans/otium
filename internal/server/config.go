package server

import (
	"fmt"
	"os"
	"strconv"
)

// Config holds all runtime configuration, read from the environment
// (12-factor). The OTIUM_OIDC_* block is optional so the public repo runs
// locally with a dev-user bypass and no IdP.
type Config struct {
	Port int

	// DBPath is the SQLite file. In-cluster this is a file on a PVC; locally a
	// path under ./data. ":memory:" for tests.
	DBPath string

	// FetchIntervalMin is how often the background ingest loop runs. 0 disables
	// it (fetch only on demand).
	FetchIntervalMin int

	// DevUser, when non-empty, bypasses all auth and auto-logs in as this user.
	// NEVER set in production.
	DevUser string

	// OIDC: when OIDCIssuer is set, otium is a confidential OIDC client of
	// auth.fisher.sh.
	OIDCIssuer        string
	OIDCInternalURL   string
	OIDCClientID      string
	OIDCClientSecret  string
	OIDCRedirectURL   string
	OIDCScopes        string
	OIDCAllowedGroups string
	SessionSecret     string
}

func LoadConfig() (*Config, error) {
	cfg := &Config{
		Port:             8080,
		DBPath:           envDefault("OTIUM_DB_PATH", "./data/otium.db"),
		FetchIntervalMin: 30,
	}

	if v := os.Getenv("PORT"); v != "" {
		p, err := strconv.Atoi(v)
		if err != nil {
			return nil, fmt.Errorf("invalid PORT: %w", err)
		}
		cfg.Port = p
	}
	if v := os.Getenv("OTIUM_FETCH_INTERVAL_MIN"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			return nil, fmt.Errorf("invalid OTIUM_FETCH_INTERVAL_MIN: %w", err)
		}
		cfg.FetchIntervalMin = n
	}

	cfg.DevUser = os.Getenv("OTIUM_DEV_USER")

	cfg.OIDCIssuer = os.Getenv("OTIUM_OIDC_ISSUER")
	cfg.OIDCInternalURL = os.Getenv("OTIUM_OIDC_INTERNAL_URL")
	cfg.OIDCClientID = os.Getenv("OTIUM_OIDC_CLIENT_ID")
	cfg.OIDCClientSecret = os.Getenv("OTIUM_OIDC_CLIENT_SECRET")
	cfg.OIDCRedirectURL = os.Getenv("OTIUM_OIDC_REDIRECT_URL")
	cfg.OIDCScopes = os.Getenv("OTIUM_OIDC_SCOPES")
	cfg.OIDCAllowedGroups = os.Getenv("OTIUM_OIDC_ALLOWED_GROUPS")
	cfg.SessionSecret = os.Getenv("OTIUM_SESSION_SECRET")
	if cfg.OIDCIssuer != "" {
		for _, p := range []struct{ k, v string }{
			{"OTIUM_OIDC_CLIENT_ID", cfg.OIDCClientID},
			{"OTIUM_OIDC_CLIENT_SECRET", cfg.OIDCClientSecret},
			{"OTIUM_SESSION_SECRET", cfg.SessionSecret},
		} {
			if p.v == "" {
				return nil, fmt.Errorf("OTIUM_OIDC_ISSUER set but %s is empty", p.k)
			}
		}
		if cfg.OIDCRedirectURL == "" {
			cfg.OIDCRedirectURL = "https://otium.fisher.sh/auth/callback"
		}
	}
	if cfg.OIDCIssuer == "" && cfg.DevUser == "" {
		return nil, fmt.Errorf("no auth configured: set OTIUM_OIDC_ISSUER (prod) or OTIUM_DEV_USER (local dev)")
	}

	return cfg, nil
}

func envDefault(key, d string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return d
}
