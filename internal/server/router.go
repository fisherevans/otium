package server

import (
	"encoding/json"
	"github.com/fisherevans/otium/internal/oidc"
	"github.com/fisherevans/otium/internal/server/handler"
	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"net/http"
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

			r.Get("/interests", h.ListInterests)
			r.Post("/interests", h.CreateInterest)
			r.Patch("/interests/{id}", h.UpdateInterest)
			r.Put("/interests/{id}/sources", h.SetInterestSources)
			r.Get("/interests/{id}/items", h.InterestItems)

			// Mixes (#86): a user-created overlay grouping interests (many-to-many).
			r.Get("/mixes", h.ListMixes)
			r.Post("/mixes", h.CreateMix)
			r.Get("/mixes/{id}", h.MixBrowse)
			r.Patch("/mixes/{id}", h.UpdateMix)
			r.Delete("/mixes/{id}", h.DeleteMix)
			r.Put("/mixes/{id}/interests", h.SetMixInterests)

			r.Get("/sources", h.ListSources)
			r.Get("/sources/stats", h.SourceStats)
			r.Post("/sources", h.CreateSource)
			r.Patch("/sources/{id}", h.UpdateSource)
			r.Delete("/sources/{id}", h.DeleteSource)
			r.Post("/sources/{id}/reset", h.ResetSourceMetadata)
			r.Put("/sources/{id}/feed-url", h.ReplaceSourceFeedURL)
			r.Put("/sources/{id}/interest", h.SetSourceInterest)
			r.Get("/sources/{id}/items", h.SourceItems)

			r.Get("/insights", h.Insights)

			// Collections (#57): named lists of saved items + builtins.
			r.Get("/collections", h.ListCollections)
			r.Post("/collections", h.CreateCollection)
			r.Patch("/collections/{id}", h.RenameCollection)
			r.Delete("/collections/{id}", h.DeleteCollection)
			r.Get("/collections/{id}/items", h.CollectionItems)
			r.Post("/collections/{id}/items", h.AddCollectionItem)
			r.Delete("/collections/{id}/items/{itemId}", h.RemoveCollectionItem)

			// Durable, stateful sessions (#67): create builds + stores a queue,
			// current resumes the active one at its cursor, patch advances the
			// cursor / ends it.
			r.Post("/sessions", h.CreateSession)
			r.Get("/sessions/current", h.CurrentSession)
			r.Patch("/sessions/{id}", h.UpdateSession)
			// On-demand full-text (#98): fetch + readability-extract the article body
			// for teaser-only interests, cached into items.content. Powers #96's actions.
			r.Get("/items/{id}/content", h.ItemContent)
			r.Post("/items/{id}/event", h.ItemEvent)
			// Dwell (#68): append-only engagement measurement, never into the ranker.
			r.Post("/items/{id}/dwell", h.ItemDwell)
			r.Post("/fetch", h.FetchNow)

			// Personal history (#83): items shown vs engaged, read-only over
			// item_state; never touches the ranker.
			r.Get("/history", h.History)

			// User settings (#68): the fast-scroll check-in toggle.
			r.Get("/settings", h.GetSettings)
			r.Patch("/settings", h.UpdateSettings)

			// Appearance preferences (#80/#81/#82): display-only reader/card/preset
			// styling. PUT merges a JSON patch; never read by the ranker.
			r.Get("/preferences", h.GetPreferences)
			r.Put("/preferences", h.UpdatePreferences)

			r.Post("/import/parse", h.ParseImport)
			r.Post("/import/commit", h.CommitImport)
		})
	})

	return r
}
