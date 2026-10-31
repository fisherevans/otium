package handler

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
)

// ClientMetrics accepts batched client timing records (#182) - today the Shorts
// transition records from web/src/lib/perf.ts - and logs each one, so device
// timings from the phone are queryable in Datadog logs (service:otium-server,
// msg "client metric"). Records are logged as given, bounded in count and size,
// never stored and never used for ranking.
func (h *Handler) ClientMetrics(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 64<<10))
	if err != nil {
		badRequest(w, "unreadable body")
		return
	}
	var records []map[string]any
	if err := json.Unmarshal(body, &records); err != nil {
		badRequest(w, "expected a JSON array")
		return
	}
	if len(records) > 50 {
		records = records[:50]
	}
	uid := userID(r)
	for _, rec := range records {
		attrs := []any{slog.Int64("user", uid)}
		for k, v := range rec {
			switch v.(type) {
			case string, float64, bool:
				attrs = append(attrs, slog.Any(k, v))
			}
		}
		h.log.Info("client metric", attrs...)
	}
	w.WriteHeader(http.StatusNoContent)
}
