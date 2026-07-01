// Command server is otium's HTTP API + feed ingest process. One binary: it
// serves the JSON API the web SPA talks to, and runs a background loop that
// pulls each source's feed on an interval. State is a single SQLite file.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/fisherevans/otium/internal/oidc"
	"github.com/fisherevans/otium/internal/server"
	"github.com/fisherevans/otium/internal/server/feeds"
	"github.com/fisherevans/otium/internal/server/handler"
	"github.com/fisherevans/otium/internal/server/middleware"
	"github.com/fisherevans/otium/internal/server/store"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(log)

	cfg, err := server.LoadConfig()
	if err != nil {
		log.Error("config error", "err", err)
		os.Exit(1)
	}

	if dir := filepath.Dir(cfg.DBPath); dir != "" && dir != "." && cfg.DBPath != ":memory:" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			log.Error("create data dir", "err", err)
			os.Exit(1)
		}
	}
	db, err := store.Open(cfg.DBPath)
	if err != nil {
		log.Error("open db", "err", err)
		os.Exit(1)
	}
	defer db.Close()

	ing := feeds.NewIngester(db, log)
	h := handler.New(db, ing, log)

	// OIDC (prod) — otium is its own confidential client of auth.fisher.sh. The
	// session resolver bridges an authenticated subject to an otium user row.
	var authn *oidc.Service
	var resolveSession middleware.SessionResolver
	if cfg.OIDCIssuer != "" {
		octx, ocancel := context.WithTimeout(context.Background(), 15*time.Second)
		authn, err = oidc.New(octx, oidc.Config{
			Issuer:        cfg.OIDCIssuer,
			InternalURL:   cfg.OIDCInternalURL,
			ClientID:      cfg.OIDCClientID,
			ClientSecret:  cfg.OIDCClientSecret,
			RedirectURL:   cfg.OIDCRedirectURL,
			Scopes:        strings.Fields(cfg.OIDCScopes),
			AllowedGroups: splitComma(cfg.OIDCAllowedGroups),
			SessionSecret: []byte(cfg.SessionSecret),
		}, log)
		ocancel()
		if err != nil {
			log.Error("oidc init failed", "err", err)
			os.Exit(1)
		}
		resolveSession = func(r *http.Request) (*middleware.Identity, error) {
			id, ok := authn.Current(r)
			if !ok {
				return nil, nil
			}
			u, err := db.UpsertUserByUsername(r.Context(), id.Subject, id.Email)
			if err != nil {
				return nil, err
			}
			return &middleware.Identity{
				UserID: u.ID, Username: id.Subject, Email: id.Email,
				Name: id.Name, Groups: strings.Join(id.Groups, ","),
			}, nil
		}
	}

	var authMiddleware func(http.Handler) http.Handler
	if cfg.DevUser != "" {
		log.Warn("DEV MODE: authentication bypassed", "dev_user", cfg.DevUser)
		authMiddleware = middleware.DevAuth(db, cfg.DevUser)
	} else {
		authMiddleware = middleware.RequireAuth(resolveSession)
	}

	router := server.NewRouter(h, authMiddleware, authn)
	srv := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Port),
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 120 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Background ingest loop. Resolves the dev/prod user lazily on each tick by
	// fetching every source across all users (single-tenant, so this is fine).
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if cfg.FetchIntervalMin > 0 {
		go ingestLoop(ctx, db, ing, cfg, log)
	}

	go func() {
		log.Info("otium-server listening", "addr", srv.Addr, "db", cfg.DBPath)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Error("server error", "err", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	log.Info("shutting down")
	shutCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutCtx)
}

// ingestLoop periodically refreshes feeds. It fetches for whichever users exist;
// in the single-tenant homelab case that's just Fisher. The dev user is created
// on first request, so the loop no-ops until then.
func ingestLoop(ctx context.Context, db *store.DB, ing *feeds.Ingester, cfg *server.Config, log *slog.Logger) {
	tick := time.NewTicker(time.Duration(cfg.FetchIntervalMin) * time.Minute)
	defer tick.Stop()
	run := func() {
		who := ingestUser(cfg)
		if who == "" {
			return // no known user to refresh for yet (prod without OTIUM_INGEST_USER)
		}
		u, err := db.UpsertUserByUsername(ctx, who, "")
		if err != nil {
			log.Warn("ingest loop: no user yet", "err", err)
			return
		}
		n, err := ing.FetchAll(ctx, u.ID)
		if err != nil {
			log.Warn("ingest loop error", "err", err)
			return
		}
		if n > 0 {
			log.Info("ingest loop", "new_items", n)
		}
	}
	run() // once at startup
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			run()
		}
	}
}

// ingestUser returns the username the background loop refreshes for. In dev
// that's the dev user; in prod it's Fisher's OIDC subject, set via
// OTIUM_INGEST_USER (falls back to the dev user).
func ingestUser(cfg *server.Config) string {
	if v := os.Getenv("OTIUM_INGEST_USER"); v != "" {
		return v
	}
	return cfg.DevUser
}

func splitComma(s string) []string {
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := parts[:0]
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
