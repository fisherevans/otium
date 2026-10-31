package middleware

import (
	"context"
	"github.com/fisherevans/otium/internal/server/store"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDevAuthPreservesExistingAccountEmail(t *testing.T) {
	db, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	user, err := db.UpsertUserByUsername(context.Background(), "tester", "person@example.test")
	if err != nil {
		t.Fatal(err)
	}
	var identity *Identity
	h := DevAuth(db, "tester")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { identity = IdentityFrom(r.Context()) }))
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/", nil))
	if identity.UserID != user.ID || identity.Email != user.Email {
		t.Fatalf("identity changed: %+v", identity)
	}
	stored, err := db.UpsertUserByUsername(context.Background(), "tester", "")
	if err != nil {
		t.Fatal(err)
	}
	if stored.Email != user.Email {
		t.Fatalf("stored email changed: %q", stored.Email)
	}
}
