package auth

import (
	"net/http"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2/humatest"

	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
	"github.com/o-mishch/devstash/backend/internal/ratelimit"
)

func TestForgotPassword(t *testing.T) {
	t.Parallel()

	t.Run("existing account emails a reset link to its primary address", func(t *testing.T) {
		t.Parallel()
		store, tokens, emailer := newFakeUserStore(), newFakeTokens(), &fakeEmailer{}
		store.add(sqlcdb.User{ID: "u1", Email: "user@example.com", Password: new(hashPassword(t, "pw"))})
		d := newFlowService(store, tokens, emailer, &fakeLimiter{}, true)
		_, api := humatest.New(t)
		registerForgotPassword(api, d)

		resp := api.Post("/auth/forgot-password", map[string]any{"email": "user@example.com"})
		if resp.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", resp.Code)
		}
		if len(emailer.resets) != 1 || emailer.resets[0] != "user@example.com" {
			t.Errorf("resets = %v, want one to the primary address", emailer.resets)
		}
	})

	t.Run("unknown account is still 200 with no email", func(t *testing.T) {
		t.Parallel()
		store, tokens, emailer := newFakeUserStore(), newFakeTokens(), &fakeEmailer{}
		d := newFlowService(store, tokens, emailer, &fakeLimiter{}, true)
		_, api := humatest.New(t)
		registerForgotPassword(api, d)
		resp := api.Post("/auth/forgot-password", map[string]any{"email": "ghost@example.com"})
		if resp.Code != http.StatusOK || len(emailer.resets) != 0 {
			t.Fatalf("status = %d resets = %d, want 200 + 0", resp.Code, len(emailer.resets))
		}
	})

	t.Run("rate limited", func(t *testing.T) {
		t.Parallel()
		lim := &fakeLimiter{deny: map[string]bool{ratelimit.BucketForgotPassword: true}, retryAfter: time.Hour}
		d := newFlowService(newFakeUserStore(), newFakeTokens(), &fakeEmailer{}, lim, true)
		_, api := humatest.New(t)
		registerForgotPassword(api, d)
		resp := api.Post("/auth/forgot-password", map[string]any{"email": "user@example.com"})
		if resp.Code != http.StatusTooManyRequests {
			t.Fatalf("status = %d, want 429", resp.Code)
		}
	})
}

func TestResetPassword(t *testing.T) {
	t.Parallel()
	now := time.Unix(1_700_000_000, 0)

	seed := func(t *testing.T, u sqlcdb.User) (*fakeUserStore, *fakeTokens, *fakeEmailer, string) {
		t.Helper()
		store, tokens, emailer := newFakeUserStore(), newFakeTokens(), &fakeEmailer{}
		store.add(u)
		raw, _ := tokens.CreatePasswordReset(t.Context(), u.Email)
		return store, tokens, emailer, raw
	}

	t.Run("verified account updates password and notifies", func(t *testing.T) {
		t.Parallel()
		user := sqlcdb.User{
			ID:            "u1",
			Email:         "user@example.com",
			Password:      new(hashPassword(t, "old")),
			EmailVerified: &now,
		}
		store, tokens, emailer, raw := seed(t, user)
		d := newFlowService(store, tokens, emailer, &fakeLimiter{}, true)
		_, api := humatest.New(t)
		registerResetPassword(api, d)

		resp := api.Post(
			"/auth/reset-password",
			map[string]any{"token": raw, "password": "brandnewpw", "confirmPassword": "brandnewpw"},
		)
		if resp.Code != http.StatusNoContent {
			t.Fatalf("status = %d, want 204; body = %s", resp.Code, resp.Body.String())
		}
		if got := store.byID["u1"].Password; got == nil || *got == *user.Password {
			t.Error("password was not updated")
		}
		if len(emailer.notifications) != 1 || emailer.notifications[0].event != SecurityPasswordReset {
			t.Errorf("notifications = %v, want one password-reset", emailer.notifications)
		}
	})

	t.Run("oauth-only account bootstraps credential login", func(t *testing.T) {
		t.Parallel()
		user := sqlcdb.User{ID: "u1", Email: "oauth@example.com"} // no password
		store, tokens, emailer, raw := seed(t, user)
		d := newFlowService(store, tokens, emailer, &fakeLimiter{}, true)
		_, api := humatest.New(t)
		registerResetPassword(api, d)

		resp := api.Post(
			"/auth/reset-password",
			map[string]any{"token": raw, "password": "brandnewpw", "confirmPassword": "brandnewpw"},
		)
		if resp.Code != http.StatusNoContent {
			t.Fatalf("status = %d, want 204", resp.Code)
		}
		if store.byID["u1"].Password == nil || store.byID["u1"].EmailVerified == nil {
			t.Error("bootstrap should set password and verify the email")
		}
		if len(emailer.notifications) != 1 || emailer.notifications[0].event != SecurityCredentialEmailAdded {
			t.Errorf("notifications = %v, want one credential-email-added", emailer.notifications)
		}
	})

	t.Run("bootstrap collision is a 400", func(t *testing.T) {
		t.Parallel()
		user := sqlcdb.User{ID: "u1", Email: "oauth@example.com"}
		store, tokens, emailer, raw := seed(t, user)
		store.forceUnique = true
		d := newFlowService(store, tokens, emailer, &fakeLimiter{}, true)
		_, api := humatest.New(t)
		registerResetPassword(api, d)
		resp := api.Post(
			"/auth/reset-password",
			map[string]any{"token": raw, "password": "brandnewpw", "confirmPassword": "brandnewpw"},
		)
		if resp.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", resp.Code)
		}
	})

	t.Run("invalid token is a 400", func(t *testing.T) {
		t.Parallel()
		d := newFlowService(newFakeUserStore(), newFakeTokens(), &fakeEmailer{}, &fakeLimiter{}, true)
		_, api := humatest.New(t)
		registerResetPassword(api, d)
		resp := api.Post(
			"/auth/reset-password",
			map[string]any{"token": "bogus", "password": "brandnewpw", "confirmPassword": "brandnewpw"},
		)
		if resp.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", resp.Code)
		}
	})

	t.Run("password mismatch is a 422", func(t *testing.T) {
		t.Parallel()
		d := newFlowService(newFakeUserStore(), newFakeTokens(), &fakeEmailer{}, &fakeLimiter{}, true)
		_, api := humatest.New(t)
		registerResetPassword(api, d)
		resp := api.Post(
			"/auth/reset-password",
			map[string]any{"token": "x", "password": "brandnewpw", "confirmPassword": "different1"},
		)
		if resp.Code != http.StatusUnprocessableEntity {
			t.Fatalf("status = %d, want 422", resp.Code)
		}
	})
}

func TestConfirmLoginEmail(t *testing.T) {
	t.Parallel()
	now := time.Unix(1_700_000_000, 0)

	t.Run("account with a password re-points the credential email", func(t *testing.T) {
		t.Parallel()
		store, tokens, emailer := newFakeUserStore(), newFakeTokens(), &fakeEmailer{}
		store.add(
			sqlcdb.User{
				ID:                      "u1",
				Email:                   "user@example.com",
				Password:                new(hashPassword(t, "pw")),
				CredentialEmail:         new("old@example.com"),
				CredentialEmailVerified: &now,
			},
		)
		raw, _ := tokens.CreateCredentialEmail(t.Context(), "u1", "fresh@example.com")
		d := newFlowService(store, tokens, emailer, &fakeLimiter{}, true)
		_, api := humatest.New(t)
		registerConfirmLoginEmail(api, d)

		resp := api.Post("/auth/confirm-login-email", map[string]any{"token": raw})
		if resp.Code != http.StatusNoContent {
			t.Fatalf("status = %d, want 204; body = %s", resp.Code, resp.Body.String())
		}
		if ce := store.byID["u1"].CredentialEmail; ce == nil || *ce != "fresh@example.com" {
			t.Errorf("credential email = %v, want fresh@example.com", ce)
		}
		if len(emailer.notifications) != 1 || emailer.notifications[0].to != "old@example.com" ||
			emailer.notifications[0].event != SecurityCredentialEmailChanged {
			t.Errorf("notifications = %v, want one change notice to the previous address", emailer.notifications)
		}
	})

	t.Run("collision on change is a 409", func(t *testing.T) {
		t.Parallel()
		store, tokens, emailer := newFakeUserStore(), newFakeTokens(), &fakeEmailer{}
		store.add(sqlcdb.User{ID: "u1", Email: "user@example.com", Password: new(hashPassword(t, "pw"))})
		store.forceUnique = true
		raw, _ := tokens.CreateCredentialEmail(t.Context(), "u1", "taken@example.com")
		d := newFlowService(store, tokens, emailer, &fakeLimiter{}, true)
		_, api := humatest.New(t)
		registerConfirmLoginEmail(api, d)
		resp := api.Post("/auth/confirm-login-email", map[string]any{"token": raw})
		if resp.Code != http.StatusConflict {
			t.Fatalf("status = %d, want 409", resp.Code)
		}
	})

	t.Run("oauth-only account without a password is a 422 and the link stays armed", func(t *testing.T) {
		t.Parallel()
		store, tokens, emailer := newFakeUserStore(), newFakeTokens(), &fakeEmailer{}
		store.add(sqlcdb.User{ID: "u1", Email: "oauth@example.com"}) // no password
		raw, _ := tokens.CreateCredentialEmail(t.Context(), "u1", "add@example.com")
		d := newFlowService(store, tokens, emailer, &fakeLimiter{}, true)
		_, api := humatest.New(t)
		registerConfirmLoginEmail(api, d)
		resp := api.Post("/auth/confirm-login-email", map[string]any{"token": raw})
		if resp.Code != http.StatusUnprocessableEntity {
			t.Fatalf("status = %d, want 422", resp.Code)
		}
		// Peek-then-consume: the password-required branch never consumes, so the single-use
		// link stays armed for the retry that supplies a password (no restore needed).
		if _, ok := tokens.cred[raw]; !ok {
			t.Error("token should stay armed for a password-required retry")
		}
	})

	t.Run("oauth-only account with a password adds credential login", func(t *testing.T) {
		t.Parallel()
		store, tokens, emailer := newFakeUserStore(), newFakeTokens(), &fakeEmailer{}
		store.add(sqlcdb.User{ID: "u1", Email: "oauth@example.com"})
		raw, _ := tokens.CreateCredentialEmail(t.Context(), "u1", "add@example.com")
		d := newFlowService(store, tokens, emailer, &fakeLimiter{}, true)
		_, api := humatest.New(t)
		registerConfirmLoginEmail(api, d)
		resp := api.Post(
			"/auth/confirm-login-email",
			map[string]any{"token": raw, "password": "brandnewpw", "confirmPassword": "brandnewpw"},
		)
		if resp.Code != http.StatusNoContent {
			t.Fatalf("status = %d, want 204; body = %s", resp.Code, resp.Body.String())
		}
		if store.byID["u1"].Password == nil {
			t.Error("password was not set")
		}
		if len(emailer.notifications) != 1 || emailer.notifications[0].event != SecurityCredentialEmailAdded {
			t.Errorf("notifications = %v, want one credential-email-added", emailer.notifications)
		}
	})

	t.Run("invalid token is a 400", func(t *testing.T) {
		t.Parallel()
		d := newFlowService(newFakeUserStore(), newFakeTokens(), &fakeEmailer{}, &fakeLimiter{}, true)
		_, api := humatest.New(t)
		registerConfirmLoginEmail(api, d)
		resp := api.Post("/auth/confirm-login-email", map[string]any{"token": "bogus"})
		if resp.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", resp.Code)
		}
	})
}
