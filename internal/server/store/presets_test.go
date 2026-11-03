package store

import (
	"context"
	"encoding/json"
	"testing"
)

func TestPresetsRoundTrip(t *testing.T) {
	ctx := context.Background()
	db, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	u, _ := db.UpsertUserByUsername(ctx, "fisher", "")
	if _, _, init, _ := db.ListPresets(ctx, u.ID); init {
		t.Fatal("a new account must report uninitialized so the browser uploads once")
	}
	setup := json.RawMessage(`{"minutes":10}`)
	if err := db.UpsertPreset(ctx, u.ID, SessionPreset{ID: "early", Name: "Early", Setup: setup}, false); err != nil {
		t.Fatal(err)
	}
	if _, _, init, _ := db.ListPresets(ctx, u.ID); init {
		t.Fatal("an agent upsert must not mark the list initialized, or the browser's first upload is skipped")
	}
	if err := db.ReplacePresets(ctx, u.ID, []SessionPreset{{ID: "b", Name: "B", Setup: setup}, {ID: "a", Name: "A", Setup: setup}}, "a"); err != nil {
		t.Fatal(err)
	}
	if err := db.UpsertPreset(ctx, u.ID, SessionPreset{ID: "everything", Name: "Everything", Setup: setup}, false); err != nil {
		t.Fatal(err)
	}
	if err := db.UpsertPreset(ctx, u.ID, SessionPreset{ID: "b", Name: "B2", Setup: setup}, true); err != nil {
		t.Fatal(err)
	}
	ps, def, init, err := db.ListPresets(ctx, u.ID)
	if err != nil || !init {
		t.Fatalf("list: %v init=%v", err, init)
	}
	ids := []string{}
	for _, p := range ps {
		ids = append(ids, p.ID+":"+p.Name)
	}
	if got := ids; len(got) != 3 || got[0] != "b:B2" || got[1] != "a:A" || got[2] != "everything:Everything" {
		t.Fatalf("order/names = %v (upsert keeps position, new ones append)", got)
	}
	if def != "b" {
		t.Fatalf("default = %q, want b", def)
	}
	if ok, _ := db.DeletePreset(ctx, u.ID, "a"); !ok {
		t.Fatal("delete a")
	}
	if ok, _ := db.DeletePreset(ctx, u.ID, "a"); ok {
		t.Fatal("second delete should report not found")
	}
}
