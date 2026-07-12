package auth

import (
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2/humatest"
	"github.com/google/go-cmp/cmp"

	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
	"github.com/o-mishch/devstash/backend/internal/ratelimit"
	"github.com/o-mishch/devstash/backend/internal/session"
)

const testPassword = "correct-horse-battery"

// verifiedUser is the standard credential account used by the login tests.
func verifiedUser(t *testing.T) sqlcdb.User {
	t.Helper()
	return sqlcdb.User{
		ID:            "user-1",
		Email:         "user@example.com",
		Password:      new(hashPassword(t, testPassword)),
		EmailVerified: new(time.Unix(1_700_000_000, 0)),
	}
}

func TestLoginSuccess(t *testing.T) {
	t.Parallel()
	user := verifiedUser(t)
	store := newFakeUserStore()
	store.add(user)
	sess := &fakeSessions{}
	d := New(Deps{
		Users:    store,
		Sessions: sess,
		Limiter:  &fakeLimiter{},
		Logger:   discardLogger(),
		Cfg:      Config{OutboundEmailEnabled: true},
	})

	_, api := humatest.New(t)
	registerLogin(api, d)

	resp := api.Post("/auth/login", map[string]any{"email": user.Email, "password": testPassword})

	if resp.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204; body = %s", resp.Code, resp.Body.String())
	}
	if sess.authedUserID != user.ID {
		t.Errorf("authenticated userID = %q, want %q", sess.authedUserID, user.ID)
	}
	if want := session.PasswordFingerprint(*user.Password); sess.authedFP != want {
		t.Errorf("session fingerprint = %q, want %q", sess.authedFP, want)
	}
}

func TestLoginNormalizesEmail(t *testing.T) {
	t.Parallel()
	user := verifiedUser(t)
	store := newFakeUserStore()
	store.add(user)
	sess := &fakeSessions{}
	d := New(Deps{Users: store, Sessions: sess, Limiter: &fakeLimiter{}, Logger: discardLogger()})

	_, api := humatest.New(t)
	registerLogin(api, d)

	// Mixed-case + padded email must still match the lowercased stored row.
	resp := api.Post("/auth/login", map[string]any{"email": "  USER@Example.com ", "password": testPassword})
	if resp.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204; body = %s", resp.Code, resp.Body.String())
	}
}

func TestLoginWrongPassword(t *testing.T) {
	t.Parallel()
	user := verifiedUser(t)
	store := newFakeUserStore()
	store.add(user)
	d := New(Deps{Users: store, Sessions: &fakeSessions{}, Limiter: &fakeLimiter{}, Logger: discardLogger()})

	_, api := humatest.New(t)
	registerLogin(api, d)

	resp := api.Post("/auth/login", map[string]any{"email": user.Email, "password": "wrong"})
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body = %s", resp.Code, resp.Body.String())
	}
	if !strings.Contains(resp.Body.String(), "Invalid email or password.") {
		t.Errorf("body = %s, want the generic invalid-credentials message", resp.Body.String())
	}
}

func TestLoginPerAccountBudgetExhausted(t *testing.T) {
	t.Parallel()
	user := verifiedUser(t)
	store := newFakeUserStore()
	store.add(user)
	// IP guard allows, but the per-account budget is exhausted → 429 instead of 400.
	lim := &fakeLimiter{deny: map[string]bool{ratelimit.BucketLogin: true}, retryAfter: 5 * time.Minute}
	d := New(Deps{Users: store, Sessions: &fakeSessions{}, Limiter: lim, Logger: discardLogger()})

	_, api := humatest.New(t)
	registerLogin(api, d)

	resp := api.Post("/auth/login", map[string]any{"email": user.Email, "password": "wrong"})
	if resp.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429; body = %s", resp.Code, resp.Body.String())
	}
}

func TestLoginIPGuardBlocks(t *testing.T) {
	t.Parallel()
	lim := &fakeLimiter{deny: map[string]bool{ratelimit.BucketLoginIP: true}, retryAfter: time.Minute}
	d := New(Deps{Users: newFakeUserStore(), Sessions: &fakeSessions{}, Limiter: lim, Logger: discardLogger()})

	_, api := humatest.New(t)
	registerLogin(api, d)

	resp := api.Post("/auth/login", map[string]any{"email": "user@example.com", "password": testPassword})
	if resp.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429; body = %s", resp.Code, resp.Body.String())
	}
}

func TestLoginUnverifiedEmailGate(t *testing.T) {
	t.Parallel()
	user := verifiedUser(t)
	user.EmailVerified = nil // unverified
	store := newFakeUserStore()
	store.add(user)

	t.Run("blocked when outbound email enabled", func(t *testing.T) {
		t.Parallel()
		d := New(Deps{
			Users:    store,
			Sessions: &fakeSessions{},
			Limiter:  &fakeLimiter{},
			Logger:   discardLogger(),
			Cfg:      Config{OutboundEmailEnabled: true},
		})
		_, api := humatest.New(t)
		registerLogin(api, d)
		resp := api.Post("/auth/login", map[string]any{"email": user.Email, "password": testPassword})
		if resp.Code != http.StatusForbidden {
			t.Fatalf("status = %d, want 403; body = %s", resp.Code, resp.Body.String())
		}
	})

	t.Run("allowed when outbound email disabled", func(t *testing.T) {
		t.Parallel()
		sess := &fakeSessions{}
		d := New(Deps{
			Users:    store,
			Sessions: sess,
			Limiter:  &fakeLimiter{},
			Logger:   discardLogger(),
			Cfg:      Config{OutboundEmailEnabled: false},
		})
		_, api := humatest.New(t)
		registerLogin(api, d)
		resp := api.Post("/auth/login", map[string]any{"email": user.Email, "password": testPassword})
		if resp.Code != http.StatusNoContent {
			t.Fatalf("status = %d, want 204; body = %s", resp.Code, resp.Body.String())
		}
	})
}

func TestLoginValidationRejectsMissingFields(t *testing.T) {
	t.Parallel()
	d := New(
		Deps{Users: newFakeUserStore(), Sessions: &fakeSessions{}, Limiter: &fakeLimiter{}, Logger: discardLogger()},
	)
	_, api := humatest.New(t)
	registerLogin(api, d)

	resp := api.Post("/auth/login", map[string]any{"password": testPassword}) // no email
	if resp.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422; body = %s", resp.Code, resp.Body.String())
	}
}

func TestLoginDBErrorIs500(t *testing.T) {
	t.Parallel()
	store := newFakeUserStore()
	store.emailErr = errors.New("connection refused")
	d := New(Deps{Users: store, Sessions: &fakeSessions{}, Limiter: &fakeLimiter{}, Logger: discardLogger()})
	_, api := humatest.New(t)
	registerLogin(api, d)

	resp := api.Post("/auth/login", map[string]any{"email": "user@example.com", "password": testPassword})
	if resp.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body = %s", resp.Code, resp.Body.String())
	}
}

func TestLoginTrimsPassword(t *testing.T) {
	t.Parallel()
	// The stored hash is of the trimmed password (register/reset/confirm all TrimSpace
	// before hashing, and existing Next rows were written via z.string().trim()), so a
	// whitespace-padded submission must still authenticate.
	user := verifiedUser(t)
	store := newFakeUserStore()
	store.add(user)
	sess := &fakeSessions{}
	d := New(Deps{Users: store, Sessions: sess, Limiter: &fakeLimiter{}, Logger: discardLogger()})

	_, api := humatest.New(t)
	registerLogin(api, d)

	resp := api.Post("/auth/login", map[string]any{"email": user.Email, "password": "  " + testPassword + "  "})
	if resp.Code != http.StatusNoContent {
		t.Fatalf("padded-password login = %d, want 204; body = %s", resp.Code, resp.Body.String())
	}
	if sess.authedUserID != user.ID {
		t.Errorf("authenticated userID = %q, want %q", sess.authedUserID, user.ID)
	}
}

func TestLoginRateLimiterCallSequence(t *testing.T) {
	user := verifiedUser(t)
	store := newFakeUserStore()
	store.add(user)
	lim := &fakeLimiter{}
	d := New(Deps{
		Users:    store,
		Sessions: &fakeSessions{},
		Limiter:  lim,
		Logger:   discardLogger(),
	})

	_, api := humatest.New(t)
	registerLogin(api, d)

	t.Run("successful login sequence", func(t *testing.T) {
		lim.calls = nil
		resp := api.Post("/auth/login", map[string]any{"email": user.Email, "password": testPassword})
		if resp.Code != http.StatusNoContent {
			t.Fatalf("status = %d, want 204", resp.Code)
		}
		expected := []string{
			ratelimit.BucketLoginIP + "|",
			ratelimit.BucketLoginAuthorizeIP + "|",
		}
		if diff := cmp.Diff(expected, lim.calls); diff != "" {
			t.Errorf("limiter call sequence mismatch (-want +got):\n%s", diff)
		}
	})

	t.Run("failed login sequence", func(t *testing.T) {
		lim.calls = nil
		resp := api.Post("/auth/login", map[string]any{"email": user.Email, "password": "wrong-password"})
		if resp.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", resp.Code)
		}
		expected := []string{
			ratelimit.BucketLoginIP + "|",
			ratelimit.BucketLogin + "|:user@example.com",
		}
		if diff := cmp.Diff(expected, lim.calls); diff != "" {
			t.Errorf("limiter call sequence mismatch (-want +got):\n%s", diff)
		}
	})
}

func TestLoginAuthorizeIPGuardBlocks(t *testing.T) {
	t.Parallel()
	user := verifiedUser(t)
	store := newFakeUserStore()
	store.add(user)
	lim := &fakeLimiter{deny: map[string]bool{ratelimit.BucketLoginAuthorizeIP: true}, retryAfter: time.Minute}
	d := New(Deps{
		Users:    store,
		Sessions: &fakeSessions{},
		Limiter:  lim,
		Logger:   discardLogger(),
	})

	_, api := humatest.New(t)
	registerLogin(api, d)

	resp := api.Post("/auth/login", map[string]any{"email": user.Email, "password": testPassword})
	if resp.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429", resp.Code)
	}
}
