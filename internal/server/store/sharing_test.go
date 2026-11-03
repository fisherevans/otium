package store

import (
	"context"
	"testing"
	"time"
)

func TestFriendHistoryStreams(t *testing.T) {
	ctx := context.Background()
	db, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	u, err := db.UpsertUserByUsername(ctx, "fisher", "f@example.com")
	if err != nil {
		t.Fatal(err)
	}
	exp := time.Now().Add(time.Hour)
	alice, _ := db.CreateShareFriend(ctx, u.ID, "Al", "tok-a", exp)
	bob, _ := db.CreateShareFriend(ctx, u.ID, "Bobby", "tok-b", exp)
	chn, _ := db.CreateShareChannel(ctx, u.ID, "general", "g1", "Server", "c1", "general")

	got, _, err := db.ShareTargetByToken(ctx, "tok-a")
	if err != nil || got == nil || got.ID != alice.ID {
		t.Fatalf("token lookup = %v, %v", got, err)
	}
	if err := db.ConnectShareFriend(ctx, alice.ID, "d-alice", "Alice"); err != nil {
		t.Fatal(err)
	}
	if err := db.ConnectShareFriend(ctx, bob.ID, "d-bob", "Bob"); err != nil {
		t.Fatal(err)
	}
	if got, _, _ := db.ShareTargetByToken(ctx, "tok-a"); got != nil {
		t.Fatal("connect token should be burned after use")
	}

	share := func(url string, delivered []int64, friends []int64, failed int64) {
		id, err := db.CreateShare(ctx, u.ID, &Share{URL: url, Title: url, StreamKey: StreamKey(friends)})
		if err != nil {
			t.Fatal(err)
		}
		for _, tid := range delivered {
			e := ""
			if tid == failed {
				e = "nope"
			}
			if err := db.RecordShareDelivery(ctx, id, tid, "m", e); err != nil {
				t.Fatal(err)
			}
		}
	}
	share("solo-1", []int64{alice.ID}, []int64{alice.ID}, 0)
	share("pair-1", []int64{bob.ID, alice.ID, chn.ID}, []int64{bob.ID, alice.ID}, 0)
	share("failed-to-alice", []int64{alice.ID}, []int64{alice.ID}, alice.ID)
	share("bob-only", []int64{bob.ID}, []int64{bob.ID}, 0)

	streams, err := db.FriendHistory(ctx, "d-alice", 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(streams) != 2 {
		t.Fatalf("alice streams = %d, want 2: %+v", len(streams), streams)
	}
	byLabel := map[string][]string{}
	for _, s := range streams {
		label := "solo"
		if len(s.Others) > 0 {
			label = s.Others[0]
		}
		for _, sh := range s.Shares {
			byLabel[label] = append(byLabel[label], sh.URL)
		}
	}
	if len(byLabel["solo"]) != 1 || byLabel["solo"][0] != "solo-1" {
		t.Errorf("solo stream = %v, want [solo-1] (failed delivery hidden)", byLabel["solo"])
	}
	if len(byLabel["Bob"]) != 1 || byLabel["Bob"][0] != "pair-1" {
		t.Errorf("shared stream = %v, want [pair-1] labelled with Bob's Discord name, not the nickname", byLabel)
	}

	ts, err := db.ListShareTargets(ctx, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(ts) != 3 {
		t.Fatalf("targets = %d, want 3", len(ts))
	}
	mine, err := db.ListShares(ctx, u.ID, alice.ID, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(mine) != 3 {
		t.Fatalf("shares to alice = %d, want 3 (including the failed one)", len(mine))
	}
}
