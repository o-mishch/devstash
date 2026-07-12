package auth

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2/humatest"

	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
	"github.com/o-mishch/devstash/backend/internal/ratelimit"
)

// newFlowService builds a *Service with all fakes for the signup/recovery handler tests.
func newFlowService(
	store *fakeUserStore,
	tokens *fakeTokens,
	emailer *fakeEmailer,
	lim *fakeLimiter,
	outbound bool,
) *Service {
	return New(Deps{
		Users:   store,
		Tokens:  tokens,
		Email:   emailer,
		Limiter: lim,
		IDs:     func() string { return "generated-id" },
		Logger:  discardLogger(),
		Cfg:     Config{OutboundEmailEnabled: outbound, AppURL: "https://app.test"},
	})
}

func TestRegisterNewUser(t *testing.T) {
	t.Parallel()

	t.Run("verification enabled sends email and returns pending redirect", func(t *testing.T) {
		t.Parallel()
		store, tokens, emailer := newFakeUserStore(), newFakeTokens(), &fakeEmailer{}
		d := newFlowService(store, tokens, emailer, &fakeLimiter{}, true)
		_, api := humatest.New(t)
		registerRegister(api, d)

		resp := api.Post("/auth/register", map[string]any{
			"name": "Ada", "email": "new@example.com", "password": "longenough", "confirmPassword": "longenough",
		})
		if resp.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body = %s", resp.Code, resp.Body.String())
		}
		if !strings.Contains(resp.Body.String(), "pending=1") {
			t.Errorf("redirect = %s, want a pending register redirect", resp.Body.String())
		}
		if len(emailer.verifications) != 1 || emailer.verifications[0] != "new@example.com" {
			t.Errorf("verifications = %v, want one to new@example.com", emailer.verifications)
		}
		if _, ok := store.byEmail["new@example.com"]; !ok {
			t.Error("user was not inserted")
		}
	})

	t.Run("verification disabled auto-verifies and redirects to sign-in", func(t *testing.T) {
		t.Parallel()
		store, tokens, emailer := newFakeUserStore(), newFakeTokens(), &fakeEmailer{}
		d := newFlowService(store, tokens, emailer, &fakeLimiter{}, false)
		_, api := humatest.New(t)
		registerRegister(api, d)

		resp := api.Post("/auth/register", map[string]any{
			"name": "Ada", "email": "new@example.com", "password": "longenough", "confirmPassword": "longenough",
		})
		if resp.Code != http.StatusOK || !strings.Contains(resp.Body.String(), "/sign-in") {
			t.Fatalf("status = %d body = %s, want 200 + /sign-in", resp.Code, resp.Body.String())
		}
		if len(emailer.verifications) != 0 {
			t.Errorf("verifications = %v, want none when email disabled", emailer.verifications)
		}
		u := store.byEmail["new@example.com"]
		if u.EmailVerified == nil {
			t.Error("new user should be auto-verified when email is disabled")
		}
	})
}

func TestRegisterExistingAccountIsEnumerationSafe(t *testing.T) {
	t.Parallel()
	now := time.Unix(1_700_000_000, 0)
	tests := []struct {
		name         string
		existing     sqlcdb.User
		wantResets   int
		wantVerifies int
	}{
		{
			name:         "oauth-only account gets a reset email",
			existing:     sqlcdb.User{ID: "u1", Email: "taken@example.com"}, // no password
			wantResets:   1,
			wantVerifies: 0,
		},
		{
			name:         "unverified credential account gets a verification email",
			existing:     sqlcdb.User{ID: "u1", Email: "taken@example.com", Password: new(hashPassword(t, "pw"))},
			wantResets:   0,
			wantVerifies: 1,
		},
		{
			name: "fully set up account gets nothing",
			existing: sqlcdb.User{
				ID:            "u1",
				Email:         "taken@example.com",
				Password:      new(hashPassword(t, "pw")),
				EmailVerified: &now,
			},
			wantResets:   0,
			wantVerifies: 0,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			store, tokens, emailer := newFakeUserStore(), newFakeTokens(), &fakeEmailer{}
			store.add(tc.existing)
			d := newFlowService(store, tokens, emailer, &fakeLimiter{}, true)
			_, api := humatest.New(t)
			registerRegister(api, d)

			resp := api.Post("/auth/register", map[string]any{
				"name": "Ada", "email": "taken@example.com", "password": "longenough", "confirmPassword": "longenough",
			})
			if resp.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200 (enumeration-safe); body = %s", resp.Code, resp.Body.String())
			}
			if len(emailer.resets) != tc.wantResets {
				t.Errorf("resets = %d, want %d", len(emailer.resets), tc.wantResets)
			}
			if len(emailer.verifications) != tc.wantVerifies {
				t.Errorf("verifications = %d, want %d", len(emailer.verifications), tc.wantVerifies)
			}
		})
	}
}

func TestRegisterExistingEmailConflictWhenEmailDisabled(t *testing.T) {
	t.Parallel()
	store, tokens, emailer := newFakeUserStore(), newFakeTokens(), &fakeEmailer{}
	store.add(sqlcdb.User{ID: "u1", Email: "taken@example.com"})
	d := newFlowService(store, tokens, emailer, &fakeLimiter{}, false)
	_, api := humatest.New(t)
	registerRegister(api, d)

	resp := api.Post("/auth/register", map[string]any{
		"name": "Ada", "email": "taken@example.com", "password": "longenough", "confirmPassword": "longenough",
	})
	if resp.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body = %s", resp.Code, resp.Body.String())
	}
}

func TestRegisterValidation(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name     string
		password string
		confirm  string
		want     int
	}{
		{
			name:     "password mismatch",
			password: "longenough",
			confirm:  "different1",
			want:     http.StatusUnprocessableEntity,
		},
		{name: "password too short", password: "short", confirm: "short", want: http.StatusUnprocessableEntity},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			d := newFlowService(newFakeUserStore(), newFakeTokens(), &fakeEmailer{}, &fakeLimiter{}, true)
			_, api := humatest.New(t)
			registerRegister(api, d)
			resp := api.Post("/auth/register", map[string]any{
				"name": "Ada", "email": "a@example.com", "password": tc.password, "confirmPassword": tc.confirm,
			})
			if resp.Code != tc.want {
				t.Fatalf("status = %d, want %d; body = %s", resp.Code, tc.want, resp.Body.String())
			}
		})
	}
}

func TestRegisterRateLimited(t *testing.T) {
	t.Parallel()
	lim := &fakeLimiter{deny: map[string]bool{ratelimit.BucketRegister: true}, retryAfter: time.Hour}
	d := newFlowService(newFakeUserStore(), newFakeTokens(), &fakeEmailer{}, lim, true)
	_, api := humatest.New(t)
	registerRegister(api, d)
	resp := api.Post("/auth/register", map[string]any{
		"name": "Ada", "email": "a@example.com", "password": "longenough", "confirmPassword": "longenough",
	})
	if resp.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429", resp.Code)
	}
}

func TestVerifyEmail(t *testing.T) {
	t.Parallel()

	t.Run("valid token verifies", func(t *testing.T) {
		t.Parallel()
		store, tokens := newFakeUserStore(), newFakeTokens()
		store.add(sqlcdb.User{ID: "u1", Email: "v@example.com"}) // unverified
		raw, _ := tokens.CreateVerification(t.Context(), "v@example.com")
		d := newFlowService(store, tokens, &fakeEmailer{}, &fakeLimiter{}, true)
		_, api := humatest.New(t)
		registerVerifyEmail(api, d)

		resp := api.Post("/auth/verify-email", map[string]any{"token": raw})
		if resp.Code != http.StatusNoContent {
			t.Fatalf("status = %d, want 204", resp.Code)
		}
		if store.byEmail["v@example.com"].EmailVerified == nil {
			t.Error("email was not marked verified")
		}
	})

	t.Run("invalid token is still 204", func(t *testing.T) {
		t.Parallel()
		d := newFlowService(newFakeUserStore(), newFakeTokens(), &fakeEmailer{}, &fakeLimiter{}, true)
		_, api := humatest.New(t)
		registerVerifyEmail(api, d)

		resp := api.Post("/auth/verify-email", map[string]any{"token": "bogus"})
		if resp.Code != http.StatusNoContent {
			t.Fatalf("status = %d, want 204", resp.Code)
		}
	})
}

func TestResendVerification(t *testing.T) {
	t.Parallel()

	t.Run("unverified account not recently sent gets an email", func(t *testing.T) {
		t.Parallel()
		store, tokens, emailer := newFakeUserStore(), newFakeTokens(), &fakeEmailer{}
		store.add(sqlcdb.User{ID: "u1", Email: "u@example.com"})
		d := newFlowService(store, tokens, emailer, &fakeLimiter{}, true)
		_, api := humatest.New(t)
		registerResendVerification(api, d)
		resp := api.Post("/auth/resend-verification", map[string]any{"email": "u@example.com"})
		if resp.Code != http.StatusNoContent {
			t.Fatalf("status = %d, want 204", resp.Code)
		}
		if len(emailer.verifications) != 1 {
			t.Errorf("verifications = %d, want 1", len(emailer.verifications))
		}
	})

	t.Run("recently sent does not re-send", func(t *testing.T) {
		t.Parallel()
		store, tokens, emailer := newFakeUserStore(), newFakeTokens(), &fakeEmailer{}
		store.add(sqlcdb.User{ID: "u1", Email: "u@example.com"})
		tokens.recentlySent = true
		d := newFlowService(store, tokens, emailer, &fakeLimiter{}, true)
		_, api := humatest.New(t)
		registerResendVerification(api, d)
		resp := api.Post("/auth/resend-verification", map[string]any{"email": "u@example.com"})
		if resp.Code != http.StatusNoContent || len(emailer.verifications) != 0 {
			t.Fatalf("status = %d verifications = %d, want 204 + 0", resp.Code, len(emailer.verifications))
		}
	})

	t.Run("unknown email is still 204 with no email", func(t *testing.T) {
		t.Parallel()
		store, tokens, emailer := newFakeUserStore(), newFakeTokens(), &fakeEmailer{}
		d := newFlowService(store, tokens, emailer, &fakeLimiter{}, true)
		_, api := humatest.New(t)
		registerResendVerification(api, d)
		resp := api.Post("/auth/resend-verification", map[string]any{"email": "ghost@example.com"})
		if resp.Code != http.StatusNoContent || len(emailer.verifications) != 0 {
			t.Fatalf("status = %d verifications = %d, want 204 + 0", resp.Code, len(emailer.verifications))
		}
	})
}
