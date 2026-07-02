package server

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"github.com/fisherevans/otium/internal/oidc"
	"github.com/fisherevans/otium/internal/server/handler"
)

// NewRouter wires the HTTP surface: health, the OIDC /auth/* flow (ungated),
// and the authenticated /api/v1 tree.
func NewRouter(h *handler.Handler, authMiddleware func(http.Handler) http.Handler, authn *oidc.Service) http.Handler {
	r := chi.NewRouter()
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins: []string{"*"},
		AllowedMethods: []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"Content-Type", "Authorization"},
	}))

	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})

	// OIDC login flow - no gate (these establish the session).
	if authn != nil {
		r.Get("/auth/login", authn.Login)
		r.Get("/auth/callback", authn.Callback)
		r.Get("/auth/logout", authn.Logout)
	}

	r.Route("/api/v1", func(r chi.Router) {
		r.Group(func(r chi.Router) {
			r.Use(authMiddleware)

			r.Get("/users/me", h.GetMe)

			r.Get("/feeds", h.ListFeeds)
			r.Post("/feeds", h.CreateFeed)
			r.Put("/feeds/{id}/sources", h.SetFeedSources)

			r.Get("/sources", h.ListSources)
			r.Post("/sources", h.CreateSource)
			r.Patch("/sources/{id}", h.UpdateSource)
			r.Delete("/sources/{id}", h.DeleteSource)
			r.Get("/sources/{id}/items", h.SourceItems)

			r.Post("/session", h.BuildSession)
			r.Post("/items/{id}/event", h.ItemEvent)
			r.Post("/fetch", h.FetchNow)

			r.Post("/import/parse", h.ParseImport)
			r.Post("/import/commit", h.CommitImport)
		})
	})

	return r
}
