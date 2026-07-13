package auth

import (
	"sync"
	"sync/atomic"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/go-cmp/cmp"
	"github.com/redis/go-redis/v9"
)

func newTestTokens(t *testing.T) *RedisTokens {
	t.Helper()
	mr := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	return NewTokens(client)
}

func TestVerificationTokenRoundTrip(t *testing.T) {
	t.Parallel()
	s := newTestTokens(t)
	ctx := t.Context()

	raw, err := s.CreateVerification(ctx, "user@example.com")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if err = s.SetVerificationSent(ctx, "user@example.com"); err != nil {
		t.Fatalf("set verification sent: %v", err)
	}
	if recent, _ := s.VerificationRecentlySent(ctx, "user@example.com"); !recent {
		t.Error("VerificationRecentlySent = false after SetVerificationSent, want true")
	}

	// Peek is non-destructive; Consume then burns the token (single-use).
	email, ok, err := s.PeekVerification(ctx, raw)
	if err != nil || !ok || email != "user@example.com" {
		t.Fatalf("peek = %q, %v, %v; want the email, true, nil", email, ok, err)
	}
	if err := s.ConsumeVerification(ctx, raw); err != nil {
		t.Fatalf("consume: %v", err)
	}
	if _, ok, _ := s.PeekVerification(ctx, raw); ok {
		t.Error("token still present after consume, want burned (single-use)")
	}
}

func TestPasswordResetPeekThenConsume(t *testing.T) {
	t.Parallel()
	s := newTestTokens(t)
	ctx := t.Context()

	raw, err := s.CreatePasswordReset(ctx, "user@example.com")
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// Peek is non-destructive: repeated peeks all succeed, so a mid-flow failure leaves
	// the emailed link usable for a retry without any compensating restore step.
	for range 3 {
		email, ok, err := s.PeekPasswordReset(ctx, raw)
		if err != nil || !ok || email != "user@example.com" {
			t.Fatalf("peek = %q, %v, %v; want the email, true, nil", email, ok, err)
		}
	}

	// Consume burns it.
	if err := s.ConsumePasswordReset(ctx, raw); err != nil {
		t.Fatalf("consume: %v", err)
	}
	if _, ok, _ := s.PeekPasswordReset(ctx, raw); ok {
		t.Error("token still present after consume, want burned (single-use)")
	}
}

func TestPasswordResetConcurrentConsumeIsIdempotent(t *testing.T) {
	t.Parallel()
	s := newTestTokens(t)
	ctx := t.Context()

	raw, err := s.CreatePasswordReset(ctx, "user@example.com")
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// The reset token has no gen-check: many concurrent consumes are all valid (a plain
	// DEL is idempotent). This documents that the reset path does NOT elect a single
	// winner — it relies on the idempotent password write, not token serialization.
	const racers = 24
	var (
		wg   sync.WaitGroup
		errs atomic.Int64
	)
	wg.Add(racers)
	for range racers {
		go func() {
			defer wg.Done()
			if cerr := s.ConsumePasswordReset(ctx, raw); cerr != nil {
				errs.Add(1)
			}
		}()
	}
	wg.Wait()

	if got := errs.Load(); got != 0 {
		t.Errorf("concurrent consume errors = %d, want 0 (idempotent delete)", got)
	}
	if _, ok, _ := s.PeekPasswordReset(ctx, raw); ok {
		t.Error("token still present after consume, want burned")
	}
}

func TestCredentialEmailPeekThenConsume(t *testing.T) {
	t.Parallel()
	s := newTestTokens(t)
	ctx := t.Context()

	raw, err := s.CreateCredentialEmail(ctx, "u1", "new@example.com")
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// Peek is non-destructive.
	payload, ok, err := s.PeekCredentialEmail(ctx, raw)
	if err != nil || !ok || payload.UserID != "u1" {
		t.Fatalf("peek = %+v, %v, %v", payload, ok, err)
	}
	if _, ok, _ := s.PeekCredentialEmail(ctx, raw); !ok {
		t.Error("second peek missed, want peek to be non-destructive")
	}

	// Consume burns it (single-use).
	consumed, err := s.ConsumeCredentialEmail(ctx, raw, payload)
	if err != nil || !consumed {
		t.Fatalf("consume = %v, %v; want true, nil", consumed, err)
	}
	if _, ok, _ := s.PeekCredentialEmail(ctx, raw); ok {
		t.Error("token still present after consume, want burned")
	}
}

func TestCredentialEmailConcurrentConsumeSingleWinner(t *testing.T) {
	t.Parallel()
	s := newTestTokens(t)
	ctx := t.Context()

	raw, err := s.CreateCredentialEmail(ctx, "u1", "e@example.com")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	payload, ok, err := s.PeekCredentialEmail(ctx, raw)
	if err != nil || !ok {
		t.Fatalf("peek: %v, %v", ok, err)
	}

	// Fire many concurrent consumes at one peeked token. The atomic gen-check + GETDEL Lua
	// must let exactly one caller win — a non-atomic read-then-delete would double-spend.
	const racers = 24
	var (
		wg   sync.WaitGroup
		wins atomic.Int64
	)
	wg.Add(racers)
	for range racers {
		go func() {
			defer wg.Done()
			if consumed, cerr := s.ConsumeCredentialEmail(ctx, raw, payload); cerr == nil && consumed {
				wins.Add(1)
			}
		}()
	}
	wg.Wait()

	if got := wins.Load(); got != 1 {
		t.Errorf("concurrent consume winners = %d, want exactly 1", got)
	}
}

func TestCredentialEmailSupersededTokenRejected(t *testing.T) {
	t.Parallel()
	s := newTestTokens(t)
	ctx := t.Context()

	first, err := s.CreateCredentialEmail(ctx, "u1", "first@example.com")
	if err != nil {
		t.Fatalf("create first: %v", err)
	}
	second, err := s.CreateCredentialEmail(ctx, "u1", "second@example.com")
	if err != nil {
		t.Fatalf("create second: %v", err)
	}

	// The superseded first link fails the gen check at peek time.
	if _, ok, _ := s.PeekCredentialEmail(ctx, first); ok {
		t.Error("superseded token peeked ok, want rejected by the gen check")
	}
	// The latest link peeks and consumes fine.
	payload, ok, err := s.PeekCredentialEmail(ctx, second)
	if err != nil || !ok {
		t.Fatalf("peek latest = %v, %v; want true, nil", ok, err)
	}
	if consumed, err := s.ConsumeCredentialEmail(ctx, second, payload); err != nil || !consumed {
		t.Fatalf("consume latest = %v, %v; want true, nil", consumed, err)
	}
}

func TestCredentialEmailConsumeRejectsSupersededPayload(t *testing.T) {
	t.Parallel()
	s := newTestTokens(t)
	ctx := t.Context()

	// Peek the first link, then mint a newer one (bumping the gen) before consuming: the
	// gen-checked consume must reject the now-stale payload even though the peek succeeded.
	first, err := s.CreateCredentialEmail(ctx, "u1", "first@example.com")
	if err != nil {
		t.Fatalf("create first: %v", err)
	}
	payload, ok, err := s.PeekCredentialEmail(ctx, first)
	if err != nil || !ok {
		t.Fatalf("peek first: %v, %v", ok, err)
	}
	if _, err := s.CreateCredentialEmail(ctx, "u1", "second@example.com"); err != nil {
		t.Fatalf("create second: %v", err)
	}
	if consumed, err := s.ConsumeCredentialEmail(ctx, first, payload); err != nil || consumed {
		t.Fatalf("consume stale = %v, %v; want false (superseded between peek and consume)", consumed, err)
	}
}

func TestCredentialEmailCorruptBlobIsError(t *testing.T) {
	t.Parallel()
	mr := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	s := NewTokens(client)
	ctx := t.Context()

	raw := "corrupt-token"
	if err := client.Set(ctx, key(nsCredentialEmail, raw), "{not-json", ttlCredentialEmail).Err(); err != nil {
		t.Fatalf("seed corrupt blob: %v", err)
	}
	if _, ok, err := s.PeekCredentialEmail(ctx, raw); err == nil || ok {
		t.Fatalf("peek corrupt = ok %v, err %v; want false + an unmarshal error", ok, err)
	}
}

func TestOAuthStateSingleUse(t *testing.T) {
	t.Parallel()
	s := newTestTokens(t)
	ctx := t.Context()

	raw, err := s.CreateOAuthState(ctx, "github")
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	provider, ok, err := s.ConsumeOAuthState(ctx, raw)
	if err != nil || !ok || provider != "github" {
		t.Fatalf("consume = %q, %v, %v; want github, true, nil", provider, ok, err)
	}
	// Single-use: a second consume misses (the GETDEL already burned it).
	if _, ok, _ := s.ConsumeOAuthState(ctx, raw); ok {
		t.Error("state consumable twice, want single-use")
	}
	// An unknown state is a clean miss, not an error.
	if _, ok, err := s.ConsumeOAuthState(ctx, "nope"); ok || err != nil {
		t.Errorf("unknown state = ok %v, err %v; want false, nil", ok, err)
	}
}

func TestPendingLinkPeekThenConsume(t *testing.T) {
	t.Parallel()
	s := newTestTokens(t)
	ctx := t.Context()

	want := PendingLink{
		Email:             "owner@example.com",
		ProviderEmail:     new("gh@example.com"),
		Provider:          "github",
		ProviderAccountID: "gh-1",
		Type:              "oauth",
		AccessToken:       new("access"),
	}
	raw, err := s.CreatePendingLink(ctx, want)
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// Peek is non-destructive and round-trips the payload.
	got, ok, err := s.PeekPendingLink(ctx, raw)
	if err != nil || !ok {
		t.Fatalf("peek = %v, %v; want true, nil", ok, err)
	}
	if diff := cmp.Diff(want, got); diff != "" {
		t.Errorf("pending link mismatch (-want +got):\n%s", diff)
	}
	if _, ok, _ := s.PeekPendingLink(ctx, raw); !ok {
		t.Error("second peek missed, want non-destructive")
	}

	// Consume burns it.
	if err := s.ConsumePendingLink(ctx, raw); err != nil {
		t.Fatalf("consume: %v", err)
	}
	if _, ok, _ := s.PeekPendingLink(ctx, raw); ok {
		t.Error("token still present after consume, want burned")
	}
}

func TestPendingLinkCorruptBlobIsError(t *testing.T) {
	t.Parallel()
	s := newTestTokens(t)
	ctx := t.Context()

	raw := "corrupt-link"
	if err := s.rdb.Set(ctx, key(nsPendingLink, raw), "{not-json", ttlPendingLink).Err(); err != nil {
		t.Fatalf("seed corrupt blob: %v", err)
	}
	if _, ok, err := s.PeekPendingLink(ctx, raw); err == nil || ok {
		t.Fatalf("peek corrupt = ok %v, err %v; want false + an unmarshal error", ok, err)
	}
}

func TestTokensStoreErrorPaths(t *testing.T) {
	t.Parallel()
	mr := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	s := NewTokens(client)
	ctx := t.Context()

	mr.Close()
	if _, err := s.CreateVerification(ctx, "e@example.com"); err == nil {
		t.Error("CreateVerification error = nil, want a redis error")
	}
	if _, err := s.CreatePasswordReset(ctx, "e@example.com"); err == nil {
		t.Error("CreatePasswordReset error = nil, want a redis error")
	}
	if _, err := s.CreateCredentialEmail(ctx, "u1", "e@example.com"); err == nil {
		t.Error("CreateCredentialEmail error = nil, want a redis error")
	}
	if err := s.SetVerificationSent(ctx, "e@example.com"); err == nil {
		t.Error("SetVerificationSent error = nil, want a redis error")
	}
	if _, _, err := s.PeekPasswordReset(ctx, "x"); err == nil {
		t.Error("PeekPasswordReset error = nil, want a redis error")
	}
	if err := s.ConsumePasswordReset(ctx, "x"); err == nil {
		t.Error("ConsumePasswordReset error = nil, want a redis error")
	}
	if _, _, err := s.PeekVerification(ctx, "x"); err == nil {
		t.Error("PeekVerification error = nil, want a redis error")
	}
	if err := s.ConsumeVerification(ctx, "x"); err == nil {
		t.Error("ConsumeVerification error = nil, want a redis error")
	}
	if _, err := s.VerificationRecentlySent(ctx, "e@example.com"); err == nil {
		t.Error("VerificationRecentlySent error = nil, want a redis error")
	}
	if _, _, err := s.PeekCredentialEmail(ctx, "x"); err == nil {
		t.Error("PeekCredentialEmail error = nil, want a redis error")
	}
	if _, err := s.ConsumeCredentialEmail(ctx, "x", CredentialEmailPayload{}); err == nil {
		t.Error("ConsumeCredentialEmail error = nil, want a redis error")
	}
	if _, err := s.CreateOAuthState(ctx, "github"); err == nil {
		t.Error("CreateOAuthState error = nil, want a redis error")
	}
	if _, _, err := s.ConsumeOAuthState(ctx, "x"); err == nil {
		t.Error("ConsumeOAuthState error = nil, want a redis error")
	}
	if _, err := s.CreatePendingLink(ctx, PendingLink{}); err == nil {
		t.Error("CreatePendingLink error = nil, want a redis error")
	}
	if _, _, err := s.PeekPendingLink(ctx, "x"); err == nil {
		t.Error("PeekPendingLink error = nil, want a redis error")
	}
	if err := s.ConsumePendingLink(ctx, "x"); err == nil {
		t.Error("ConsumePendingLink error = nil, want a redis error")
	}
}
