package handler

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"github.com/fisherevans/otium/internal/server/store"
	"github.com/go-chi/chi/v5"
)

// Follow recommendations (#202). The devbox recommender reads an engagement
// profile and writes suggestions through the agent API; Fisher acts on them in
// the Suggestions screen. A suggestion is not a source until it is tried, so the
// Library only ever shows what he chose (or a confident trial the recommender
// seeded, which is labelled as a trial).

// AgentProfile is the recommender's input: per-source engagement plus the
// topics a trial can land in.
func (h *Handler) AgentProfile(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	days := intParam(r, "days", 90)
	eng, err := h.db.EngagementBySource(r.Context(), uid, days)
	if err != nil {
		serverError(w, h.log, "engagement profile", err)
		return
	}
	topics, err := h.db.ListTopics(r.Context(), uid)
	if err != nil {
		serverError(w, h.log, "list topics", err)
		return
	}
	type topicJSON struct {
		Slug    string `json:"slug"`
		Name    string `json:"name"`
		Section string `json:"section"`
	}
	ts := make([]topicJSON, 0, len(topics))
	for _, t := range topics {
		ts = append(ts, topicJSON{Slug: t.Slug, Name: t.Name, Section: t.SectionName})
	}
	known, err := h.db.ListSuggestions(r.Context(), uid)
	if err != nil {
		serverError(w, h.log, "list suggestions", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sources": eng, "topics": ts, "suggestions": known})
}

type agentSuggestion struct {
	store.Suggestion
	Trial bool `json:"trial"` // seed it as a trial source straight away
	// Follow adds it as a followed source straight away (#216): for a source the
	// owner asked an agent to add, not one the recommender proposes.
	Follow bool `json:"follow"`
}

// AgentSuggest records new suggestions. Anything already followed or ever
// suggested is skipped, so a rerun is safe. Trials become sources at once.
func (h *Handler) AgentSuggest(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	var body struct {
		Suggestions []agentSuggestion `json:"suggestions"`
	}
	if !decode(w, r, &body) {
		return
	}
	var added, trials, followed, skipped int
	for _, s := range body.Suggestions {
		if s.FeedURL == "" || s.Title == "" || !validSuggestKind(s.Kind) {
			skipped++
			continue
		}
		known, err := h.db.KnownFeed(r.Context(), uid, s.FeedURL)
		if err != nil {
			serverError(w, h.log, "known feed", err)
			return
		}
		if known {
			skipped++
			continue
		}
		id, err := h.db.InsertSuggestion(r.Context(), uid, &s.Suggestion)
		if err != nil {
			serverError(w, h.log, "insert suggestion", err)
			return
		}
		added++
		if s.Trial || s.Follow {
			src, err := h.startTrial(r.Context(), uid, id, &s.Suggestion)
			if err != nil {
				h.log.Warn("seed trial failed", "feed", s.FeedURL, "err", err)
				continue
			}
			if !s.Follow {
				trials++
				continue
			}
			if _, err := h.db.FollowSource(r.Context(), uid, src.ID); err != nil {
				serverError(w, h.log, "follow source", err)
				return
			}
			followed++
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"added": added, "trials": trials, "followed": followed, "skipped": skipped})
}

// AgentFollowSource makes an existing source a followed one (#216): what Keep
// does for a trial in the app.
func (h *Handler) AgentFollowSource(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	ok, err := h.db.FollowSource(r.Context(), userID(r), id)
	if err != nil {
		serverError(w, h.log, "follow source", err)
		return
	}
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]any{"code": "not_found", "message": "source not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func validSuggestKind(k string) bool {
	switch k {
	case "bluesky", "substack", "medium", "tumblr", "youtube", "rss":
		return true
	}
	return false
}

// startTrial turns a suggestion into a trial source in its proposed topic and
// pulls its items so it can appear in the next session.
func (h *Handler) startTrial(ctx context.Context, uid, suggestionID int64, s *store.Suggestion) (*store.Source, error) {
	src, err := h.db.CreateSource(ctx, &store.Source{
		UserID: uid, Kind: s.Kind, Title: s.Title, FeedURL: s.FeedURL, IconURL: s.IconURL,
		HomepageURL: s.HomeURL, State: "trial",
	})
	if err != nil {
		return nil, err
	}
	if s.TopicSlug != "" {
		if err := h.db.SetSourceTopic(ctx, uid, src.ID, s.TopicSlug); err != nil {
			h.log.Warn("trial topic", "slug", s.TopicSlug, "err", err)
		}
	}
	if s.Kind == "bluesky" {
		// Busy-source defaults, as the add-source wizard uses (#197).
		cfg := `{"direction":"popular"}`
		days := 3
		_ = h.db.UpdateSource(ctx, uid, src.ID, store.SourcePatch{ScoringConfig: &cfg, ArchiveAfterDays: &days})
	}
	sid := src.ID
	if err := h.db.SetSuggestionStatus(ctx, uid, suggestionID, "trial", &sid); err != nil {
		return nil, err
	}
	go func(s store.Source) {
		if _, err := h.ing.FetchSource(context.Background(), s); err != nil {
			h.log.Warn("trial first fetch", "source", s.Title, "err", err)
		}
	}(*src)
	return src, nil
}

// ListSuggestions serves the Suggestions screen: trials in progress and pending
// suggestions.
func (h *Handler) ListSuggestions(w http.ResponseWriter, r *http.Request) {
	statuses := []string{"pending", "trial"}
	if q := r.URL.Query().Get("status"); q != "" {
		statuses = strings.Split(q, ",")
	}
	out, err := h.db.ListSuggestions(r.Context(), userID(r), statuses...)
	if err != nil {
		serverError(w, h.log, "list suggestions", err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// SuggestionAction applies try | keep | dismiss to a suggestion.
//   - try: pending -> a trial source.
//   - keep: a trial -> a followed source.
//   - dismiss: pending is never offered again; a trial's source is archived.
func (h *Handler) SuggestionAction(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	action := chi.URLParam(r, "action")
	s, err := h.db.GetSuggestion(r.Context(), uid, id)
	if err != nil {
		serverError(w, h.log, "get suggestion", err)
		return
	}
	if s == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"code": "not_found", "message": "suggestion not found"})
		return
	}
	switch action {
	case "try":
		if s.Status != "pending" {
			badRequest(w, "only a pending suggestion can be tried")
			return
		}
		if _, err := h.startTrial(r.Context(), uid, s.ID, s); err != nil {
			serverError(w, h.log, "start trial", err)
			return
		}
	case "keep":
		if s.SourceID == 0 {
			badRequest(w, "try it before keeping it")
			return
		}
		if err := h.db.SetSourceState(r.Context(), uid, s.SourceID, "followed"); err != nil {
			serverError(w, h.log, "keep source", err)
			return
		}
		if err := h.db.SetSuggestionStatus(r.Context(), uid, s.ID, "followed", nil); err != nil {
			serverError(w, h.log, "keep suggestion", err)
			return
		}
	case "dismiss":
		if s.SourceID != 0 && s.Status == "trial" {
			if err := h.db.SetSourceState(r.Context(), uid, s.SourceID, "archived"); err != nil {
				serverError(w, h.log, "drop trial", err)
				return
			}
		}
		if err := h.db.SetSuggestionStatus(r.Context(), uid, s.ID, "dismissed", nil); err != nil {
			serverError(w, h.log, "dismiss suggestion", err)
			return
		}
	default:
		badRequest(w, "unknown action")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
