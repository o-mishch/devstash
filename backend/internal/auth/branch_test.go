package auth

import (
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2/humatest"

	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
	"github.com/o-mishch/devstash/backend/internal/ratelimit"
)

// TestConfirmLoginEmailErrorPaths covers the 500 branches of the confirm-login-email
// flow: a token-store read failure, and a non-unique DB error on both the change and add
// write paths (distinct from the 409 unique-violation collisions tested elsewhere).
func TestConfirmLoginEmailErrorPaths(t *testing.T) {
	t.Parallel()
	now := time.Unix(1_700_000_000, 0)

	t.Run("token read failure is a 500", func(t *testing.T) {
		t.Parallel()
		tokens := newFakeTokens()
		tokens.credPeekErr = errors.New("redis down")
		d := newFlowService(newFakeUserStore(), tokens, &fakeEmailer{}, &fakeLimiter{}, true)
		_, api := humatest.New(t)
		registerConfirmLoginEmail(api, d)
		resp := api.Post("/auth/confirm-login-email", map[string]any{"token": "x"})
		if resp.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", resp.Code)
		}
	})

	t.Run("change write DB error is a 500", func(t *testing.T) {
		t.Parallel()
		store, tokens := newFakeUserStore(), newFakeTokens()
		store.add(sqlcdb.User{
			ID: "u1", Email: "user@example.com", Password: new(hashPassword(t, "pw")),
			CredentialEmail: new("old@example.com"), CredentialEmailVerified: &now,
		})
		store.credWriteErr = errors.New("connection refused")
		raw, _ := tokens.CreateCredentialEmail(t.Context(), "u1", "fresh@example.com")
		d := newFlowService(store, tokens, &fakeEmailer{}, &fakeLimiter{}, true)
		_, api := humatest.New(t)
		registerConfirmLoginEmail(api, d)
		resp := api.Post("/auth/confirm-login-email", map[string]any{"token": raw})
		if resp.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", resp.Code)
		}
	})

	t.Run("add write DB error is a 500", func(t *testing.T) {
		t.Parallel()
		store, tokens := newFakeUserStore(), newFakeTokens()
		store.add(sqlcdb.User{ID: "u1", Email: "oauth@example.com"}) // no password
		store.credWriteErr = errors.New("connection refused")
		raw, _ := tokens.CreateCredentialEmail(t.Context(), "u1", "add@example.com")
		d := newFlowService(store, tokens, &fakeEmailer{}, &fakeLimiter{}, true)
		_, api := humatest.New(t)
		registerConfirmLoginEmail(api, d)
		resp := api.Post(
			"/auth/confirm-login-email",
			map[string]any{"token": raw, "password": "brandnewpw", "confirmPassword": "brandnewpw"},
		)
		if resp.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", resp.Code)
		}
	})

	t.Run("change succeeds even when the notification email fails", func(t *testing.T) {
		t.Parallel()
		store, tokens := newFakeUserStore(), newFakeTokens()
		store.add(sqlcdb.User{
			ID: "u1", Email: "user@example.com", Password: new(hashPassword(t, "pw")),
			CredentialEmail: new("old@example.com"), CredentialEmailVerified: &now,
		})
		emailer := &fakeEmailer{err: errors.New("resend down")}
		raw, _ := tokens.CreateCredentialEmail(t.Context(), "u1", "fresh@example.com")
		d := newFlowService(store, tokens, emailer, &fakeLimiter{}, true)
		_, api := humatest.New(t)
		registerConfirmLoginEmail(api, d)
		resp := api.Post("/auth/confirm-login-email", map[string]any{"token": raw})
		if resp.Code != http.StatusNoContent {
			t.Fatalf("status = %d, want 204 (notify failure is best-effort); body = %s", resp.Code, resp.Body.String())
		}
	})
}

func TestRegisterInsertRaceRecovered(t *testing.T) {
	t.Parallel()
	now := time.Unix(1_700_000_000, 0)
	store, tokens, emailer := newFakeUserStore(), newFakeTokens(), &fakeEmailer{}
	// The account doesn't exist at lookup time, but the insert 23505s because a
	// concurrent request created it (fully set up → the nudge sends nothing).
	store.insertRace = sqlcdb.User{
		ID:            "raced",
		Email:         "race@example.com",
		Password:      new(hashPassword(t, "pw")),
		EmailVerified: &now,
	}
	d := newFlowService(store, tokens, emailer, &fakeLimiter{}, true)
	_, api := humatest.New(t)
	registerRegister(api, d)

	resp := api.Post("/auth/register", map[string]any{
		"name": "Ada", "email": "race@example.com", "password": "longenough", "confirmPassword": "longenough",
	})
	if resp.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (race recovered); body = %s", resp.Code, resp.Body.String())
	}
	if len(emailer.verifications)+len(emailer.resets) != 0 {
		t.Error("a fully-set-up raced account should trigger no email")
	}
}

// TestRegisterErrorPaths covers the 500 branches of registration: a DB lookup failure
// during the any-email resolution, and a token-store failure while sending the
// verification email.
func TestRegisterErrorPaths(t *testing.T) {
	t.Parallel()

	t.Run("lookup DB error is a 500", func(t *testing.T) {
		t.Parallel()
		store := newFakeUserStore()
		store.emailErr = errors.New("connection refused")
		d := newFlowService(store, newFakeTokens(), &fakeEmailer{}, &fakeLimiter{}, true)
		_, api := humatest.New(t)
		registerRegister(api, d)
		resp := api.Post("/auth/register", map[string]any{
			"name": "Ada", "email": "new@example.com", "password": "longenough", "confirmPassword": "longenough",
		})
		if resp.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", resp.Code)
		}
	})

	t.Run("verification token mint failure is a 500", func(t *testing.T) {
		t.Parallel()
		tokens := newFakeTokens()
		tokens.createErr = errors.New("redis down")
		d := newFlowService(newFakeUserStore(), tokens, &fakeEmailer{}, &fakeLimiter{}, true)
		_, api := humatest.New(t)
		registerRegister(api, d)
		resp := api.Post("/auth/register", map[string]any{
			"name": "Ada", "email": "new@example.com", "password": "longenough", "confirmPassword": "longenough",
		})
		if resp.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", resp.Code)
		}
	})
}

func TestResendVerificationVerifiedAccountSendsNothing(t *testing.T) {
	t.Parallel()
	now := time.Unix(1_700_000_000, 0)
	store, tokens, emailer := newFakeUserStore(), newFakeTokens(), &fakeEmailer{}
	store.add(sqlcdb.User{ID: "u1", Email: "done@example.com", EmailVerified: &now})
	d := newFlowService(store, tokens, emailer, &fakeLimiter{}, true)
	_, api := humatest.New(t)
	registerResendVerification(api, d)

	resp := api.Post("/auth/resend-verification", map[string]any{"email": "done@example.com"})
	if resp.Code != http.StatusNoContent || len(emailer.verifications) != 0 {
		t.Fatalf("status = %d verifications = %d, want 204 + 0", resp.Code, len(emailer.verifications))
	}
}

func TestResendVerificationRateLimited(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name   string
		bucket string
	}{
		{name: "ip guard", bucket: ratelimit.BucketResendVerificationIP},
		{name: "ip+email bucket", bucket: ratelimit.BucketResendVerification},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			lim := &fakeLimiter{deny: map[string]bool{tc.bucket: true}, retryAfter: 15 * time.Minute}
			d := newFlowService(newFakeUserStore(), newFakeTokens(), &fakeEmailer{}, lim, true)
			_, api := humatest.New(t)
			registerResendVerification(api, d)
			resp := api.Post("/auth/resend-verification", map[string]any{"email": "u@example.com"})
			if resp.Code != http.StatusTooManyRequests {
				t.Fatalf("status = %d, want 429", resp.Code)
			}
		})
	}
}

func TestResetPasswordUnverifiedAccount(t *testing.T) {
	t.Parallel()
	store, tokens, emailer := newFakeUserStore(), newFakeTokens(), &fakeEmailer{}
	// Has a password but the email is unverified → SetPasswordAndVerifyEmail path.
	store.add(sqlcdb.User{ID: "u1", Email: "unverified@example.com", Password: new(hashPassword(t, "old"))})
	raw, _ := tokens.CreatePasswordReset(t.Context(), "unverified@example.com")
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
	if store.byID["u1"].EmailVerified == nil {
		t.Error("reset on an unverified account should verify the email")
	}
	if len(emailer.notifications) != 1 || emailer.notifications[0].event != SecurityPasswordReset {
		t.Errorf("notifications = %v, want one password-reset", emailer.notifications)
	}
}

func TestConfirmLoginEmailAddCollision(t *testing.T) {
	t.Parallel()
	store, tokens, emailer := newFakeUserStore(), newFakeTokens(), &fakeEmailer{}
	store.add(sqlcdb.User{ID: "u1", Email: "oauth@example.com"}) // no password
	store.forceUnique = true
	raw, _ := tokens.CreateCredentialEmail(t.Context(), "u1", "taken@example.com")
	d := newFlowService(store, tokens, emailer, &fakeLimiter{}, true)
	_, api := humatest.New(t)
	registerConfirmLoginEmail(api, d)

	resp := api.Post(
		"/auth/confirm-login-email",
		map[string]any{"token": raw, "password": "brandnewpw", "confirmPassword": "brandnewpw"},
	)
	if resp.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body = %s", resp.Code, resp.Body.String())
	}
	// A 409 means the target email belongs to someone else: the single-use link is
	// spent (the body tells the user to request a new one). This guards against the
	// isHumaStatus regression where the conflict branch was never detected — leaving the
	// token unconsumed and a "used" link still redeemable.
	if _, ok := tokens.cred[raw]; ok {
		t.Error("token must be burned on a 409 conflict; the spent link should not stay redeemable")
	}
}

// TestConfirmLoginEmailChangeCollision is the change-path (user already has a
// password) analogue of the add-path collision: re-pointing the credential email to
// one already in use is a 409, and the consumed link must stay burned.
func TestConfirmLoginEmailChangeCollision(t *testing.T) {
	t.Parallel()
	now := time.Unix(1_700_000_000, 0)
	store, tokens, emailer := newFakeUserStore(), newFakeTokens(), &fakeEmailer{}
	store.add(sqlcdb.User{
		ID: "u1", Email: "user@example.com", Password: new(hashPassword(t, "pw")),
		CredentialEmail: new("old@example.com"), CredentialEmailVerified: &now,
	})
	store.forceUnique = true
	raw, _ := tokens.CreateCredentialEmail(t.Context(), "u1", "taken@example.com")
	d := newFlowService(store, tokens, emailer, &fakeLimiter{}, true)
	_, api := humatest.New(t)
	registerConfirmLoginEmail(api, d)

	resp := api.Post("/auth/confirm-login-email", map[string]any{"token": raw})
	if resp.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body = %s", resp.Code, resp.Body.String())
	}
	if _, ok := tokens.cred[raw]; ok {
		t.Error("token must be burned on a 409 conflict; the spent link should not stay redeemable")
	}
}

func TestConfirmLoginEmailRateLimited(t *testing.T) {
	t.Parallel()
	lim := &fakeLimiter{deny: map[string]bool{ratelimit.BucketConfirmLoginEmail: true}, retryAfter: 15 * time.Minute}
	d := newFlowService(newFakeUserStore(), newFakeTokens(), &fakeEmailer{}, lim, true)
	_, api := humatest.New(t)
	registerConfirmLoginEmail(api, d)
	resp := api.Post("/auth/confirm-login-email", map[string]any{"token": "x"})
	if resp.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429", resp.Code)
	}
}

func TestRegisterFindsExistingViaAccountEmail(t *testing.T) {
	t.Parallel()
	store, tokens, emailer := newFakeUserStore(), newFakeTokens(), &fakeEmailer{}
	// Existing OAuth-only account discoverable only by its linked account email.
	u := sqlcdb.User{ID: "u1", Email: "primary@example.com"}
	store.byID[u.ID] = u
	store.byAccountEmail["linked@example.com"] = u
	d := newFlowService(store, tokens, emailer, &fakeLimiter{}, true)
	_, api := humatest.New(t)
	registerRegister(api, d)

	resp := api.Post("/auth/register", map[string]any{
		"name": "Ada", "email": "linked@example.com", "password": "longenough", "confirmPassword": "longenough",
	})
	if resp.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body = %s", resp.Code, resp.Body.String())
	}
	// OAuth-only existing account → reset email offered.
	if len(emailer.resets) != 1 {
		t.Errorf("resets = %d, want 1 (oauth-only nudge)", len(emailer.resets))
	}
}

func TestResetPasswordUnknownUserIs400(t *testing.T) {
	t.Parallel()
	store, tokens := newFakeUserStore(), newFakeTokens()
	// Token resolves to an email with no matching account.
	raw, _ := tokens.CreatePasswordReset(t.Context(), "ghost@example.com")
	d := newFlowService(store, tokens, &fakeEmailer{}, &fakeLimiter{}, true)
	_, api := humatest.New(t)
	registerResetPassword(api, d)

	resp := api.Post(
		"/auth/reset-password",
		map[string]any{"token": raw, "password": "brandnewpw", "confirmPassword": "brandnewpw"},
	)
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.Code)
	}
}

func TestConfirmLoginEmailUnknownUserIs400(t *testing.T) {
	t.Parallel()
	store, tokens := newFakeUserStore(), newFakeTokens()
	// Token payload references a user that no longer exists.
	raw, _ := tokens.CreateCredentialEmail(t.Context(), "ghost", "e@example.com")
	d := newFlowService(store, tokens, &fakeEmailer{}, &fakeLimiter{}, true)
	_, api := humatest.New(t)
	registerConfirmLoginEmail(api, d)

	resp := api.Post("/auth/confirm-login-email", map[string]any{"token": raw})
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.Code)
	}
}

// TestForgotPasswordLookupErrorStillReturns200 proves the enumeration-safe contract
// holds even when the DB lookup fails: the handler logs the error but still returns the
// constant 200 redirect and sends no email, never leaking that the lookup broke.
func TestForgotPasswordLookupErrorStillReturns200(t *testing.T) {
	t.Parallel()
	store := newFakeUserStore()
	store.emailErr = errors.New("connection refused")
	emailer := &fakeEmailer{}
	d := newFlowService(store, newFakeTokens(), emailer, &fakeLimiter{}, true)
	_, api := humatest.New(t)
	registerForgotPassword(api, d)

	resp := api.Post("/auth/forgot-password", map[string]any{"email": "user@example.com"})
	if resp.Code != http.StatusOK || len(emailer.resets) != 0 {
		t.Fatalf("status = %d resets = %d, want 200 + 0 (enumeration-safe on lookup failure)",
			resp.Code, len(emailer.resets))
	}
}

// TestResetPasswordShortPasswordIs422 covers the min-length guard, which runs before the
// token is ever consumed.
func TestResetPasswordShortPasswordIs422(t *testing.T) {
	t.Parallel()
	d := newFlowService(newFakeUserStore(), newFakeTokens(), &fakeEmailer{}, &fakeLimiter{}, true)
	_, api := humatest.New(t)
	registerResetPassword(api, d)

	resp := api.Post(
		"/auth/reset-password",
		map[string]any{"token": "x", "password": "short", "confirmPassword": "short"},
	)
	if resp.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422 (password below the 8-char minimum)", resp.Code)
	}
}

// TestResetPasswordLookupErrorIs500 covers applyPasswordReset's hard-error path: the
// token consumes, but a non-NoRows DB error on the user lookup surfaces as a 500 (as
// opposed to the invalid-token 400 or the unknown-user 400).
func TestResetPasswordLookupErrorIs500(t *testing.T) {
	t.Parallel()
	store, tokens := newFakeUserStore(), newFakeTokens()
	store.emailErr = errors.New("connection refused")
	raw, _ := tokens.CreatePasswordReset(t.Context(), "user@example.com")
	d := newFlowService(store, tokens, &fakeEmailer{}, &fakeLimiter{}, true)
	_, api := humatest.New(t)
	registerResetPassword(api, d)

	resp := api.Post(
		"/auth/reset-password",
		map[string]any{"token": raw, "password": "brandnewpw", "confirmPassword": "brandnewpw"},
	)
	if resp.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (hard DB error on the post-consume user lookup)", resp.Code)
	}
}

// TestRegisterBlankNameIs422 covers the post-trim empty-name guard (a name of only
// whitespace passes Huma's minLength but trims to empty in the handler).
func TestRegisterBlankNameIs422(t *testing.T) {
	t.Parallel()
	d := newFlowService(newFakeUserStore(), newFakeTokens(), &fakeEmailer{}, &fakeLimiter{}, true)
	_, api := humatest.New(t)
	registerRegister(api, d)

	resp := api.Post("/auth/register", map[string]any{
		"name": "   ", "email": "new@example.com", "password": "longenough", "confirmPassword": "longenough",
	})
	if resp.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422 (blank name after trim)", resp.Code)
	}
}

// TestResendVerificationLookupErrorIs500 covers the resend 500 branch: a non-NoRows DB
// error on the unverified-user lookup surfaces as a 500 (a NoRows miss stays 204).
func TestResendVerificationLookupErrorIs500(t *testing.T) {
	t.Parallel()
	store := newFakeUserStore()
	store.emailErr = errors.New("connection refused")
	d := newFlowService(store, newFakeTokens(), &fakeEmailer{}, &fakeLimiter{}, true)
	_, api := humatest.New(t)
	registerResendVerification(api, d)

	resp := api.Post("/auth/resend-verification", map[string]any{"email": "user@example.com"})
	if resp.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (hard DB error on the unverified-user lookup)", resp.Code)
	}
}
