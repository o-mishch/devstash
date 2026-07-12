package auth

import (
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/humatest"

	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
	"github.com/o-mishch/devstash/backend/internal/ratelimit"
)

// overLongPassword is 73 bytes — it clears validateNewPassword's 72-char cap only when
// validation is bypassed (a direct service-method call), so it is the sole way to drive
// bcrypt (and thus hashForStorage) into its error return.
var overLongPassword = strings.Repeat("a", 73)

// --- reset-password error legs ---

func TestResetPasswordErrorPaths(t *testing.T) {
	t.Parallel()
	now := time.Unix(1_700_000_000, 0)

	t.Run("rate limited is a 429", func(t *testing.T) {
		t.Parallel()
		lim := &fakeLimiter{deny: map[string]bool{ratelimit.BucketResetPassword: true}, retryAfter: time.Minute}
		d := newFlowService(newFakeUserStore(), newFakeTokens(), &fakeEmailer{}, lim, true)
		_, api := humatest.New(t)
		registerResetPassword(api, d)
		resp := api.Post(
			"/auth/reset-password",
			map[string]any{"token": "x", "password": "brandnewpw", "confirmPassword": "brandnewpw"},
		)
		if resp.Code != http.StatusTooManyRequests {
			t.Fatalf("status = %d, want 429", resp.Code)
		}
	})

	t.Run("token read failure is a 500", func(t *testing.T) {
		t.Parallel()
		tokens := newFakeTokens()
		tokens.resetPeekErr = errors.New("redis down")
		d := newFlowService(newFakeUserStore(), tokens, &fakeEmailer{}, &fakeLimiter{}, true)
		_, api := humatest.New(t)
		registerResetPassword(api, d)
		resp := api.Post(
			"/auth/reset-password",
			map[string]any{"token": "x", "password": "brandnewpw", "confirmPassword": "brandnewpw"},
		)
		if resp.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", resp.Code)
		}
	})

	t.Run("password write failure leaves the token armed and 500s", func(t *testing.T) {
		t.Parallel()
		store, tokens := newFakeUserStore(), newFakeTokens()
		// Fully set-up account → the default UpdateUserPassword path.
		store.add(sqlcdb.User{
			ID: "u1", Email: "user@example.com", Password: new(hashPassword(t, "old")), EmailVerified: &now,
		})
		store.pwWriteErr = errors.New("connection refused")
		raw, _ := tokens.CreatePasswordReset(t.Context(), "user@example.com")
		d := newFlowService(store, tokens, &fakeEmailer{}, &fakeLimiter{}, true)
		_, api := humatest.New(t)
		registerResetPassword(api, d)
		resp := api.Post(
			"/auth/reset-password",
			map[string]any{"token": raw, "password": "brandnewpw", "confirmPassword": "brandnewpw"},
		)
		if resp.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", resp.Code)
		}
		// Peek-then-consume: a transient write failure never consumes the token, so the
		// emailed link stays usable for a retry with no compensating restore.
		if _, ok := tokens.reset[raw]; !ok {
			t.Error("token should stay armed after a transient write failure")
		}
	})

	t.Run("unverified-account write failure is a 500", func(t *testing.T) {
		t.Parallel()
		store, tokens := newFakeUserStore(), newFakeTokens()
		// Has a password but unverified → the SetPasswordAndVerifyEmail path.
		store.add(sqlcdb.User{ID: "u1", Email: "user@example.com", Password: new(hashPassword(t, "old"))})
		store.pwWriteErr = errors.New("connection refused")
		raw, _ := tokens.CreatePasswordReset(t.Context(), "user@example.com")
		d := newFlowService(store, tokens, &fakeEmailer{}, &fakeLimiter{}, true)
		_, api := humatest.New(t)
		registerResetPassword(api, d)
		resp := api.Post(
			"/auth/reset-password",
			map[string]any{"token": raw, "password": "brandnewpw", "confirmPassword": "brandnewpw"},
		)
		if resp.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", resp.Code)
		}
	})

	t.Run("notification failure still 204s", func(t *testing.T) {
		t.Parallel()
		store, tokens := newFakeUserStore(), newFakeTokens()
		store.add(sqlcdb.User{
			ID: "u1", Email: "user@example.com", Password: new(hashPassword(t, "old")), EmailVerified: &now,
		})
		emailer := &fakeEmailer{err: errors.New("resend down")}
		raw, _ := tokens.CreatePasswordReset(t.Context(), "user@example.com")
		d := newFlowService(store, tokens, emailer, &fakeLimiter{}, true)
		_, api := humatest.New(t)
		registerResetPassword(api, d)
		resp := api.Post(
			"/auth/reset-password",
			map[string]any{"token": raw, "password": "brandnewpw", "confirmPassword": "brandnewpw"},
		)
		if resp.Code != http.StatusNoContent {
			t.Fatalf("status = %d, want 204 (notify failure is best-effort); body = %s", resp.Code, resp.Body.String())
		}
	})
}

// TestApplyPasswordResetHashError drives hashForStorage's bcrypt error directly: the
// handler caps passwords at 72 chars, so an over-long password only reaches the hash
// step when applyPasswordReset is called below the HTTP layer.
func TestApplyPasswordResetHashError(t *testing.T) {
	t.Parallel()
	now := time.Unix(1_700_000_000, 0)
	store, tokens := newFakeUserStore(), newFakeTokens()
	store.add(sqlcdb.User{
		ID: "u1", Email: "user@example.com", Password: new(hashPassword(t, "old")), EmailVerified: &now,
	})
	raw, _ := tokens.CreatePasswordReset(t.Context(), "user@example.com")
	d := newFlowService(store, tokens, &fakeEmailer{}, &fakeLimiter{}, true)

	ok, err := d.applyPasswordReset(t.Context(), raw, overLongPassword)
	if ok || err == nil {
		t.Fatalf("applyPasswordReset(over-long pw) = ok %v, err %v; want false + a hash error", ok, err)
	}
	// The hash error is a transient-style failure: the token must stay armed for a retry.
	if _, ok := tokens.reset[raw]; !ok {
		t.Error("token should stay armed after a hash failure")
	}
}

// TestResetPasswordBurnFailureStill204 proves the terminal token burn is best-effort: a
// failure to delete the (already-applied) reset token is logged, not surfaced, so a
// successful reset still returns 204.
func TestResetPasswordBurnFailureStill204(t *testing.T) {
	t.Parallel()
	now := time.Unix(1_700_000_000, 0)
	store, tokens := newFakeUserStore(), newFakeTokens()
	store.add(sqlcdb.User{
		ID: "u1", Email: "user@example.com", Password: new(hashPassword(t, "old")), EmailVerified: &now,
	})
	tokens.resetBurnErr = errors.New("redis down")
	raw, _ := tokens.CreatePasswordReset(t.Context(), "user@example.com")
	d := newFlowService(store, tokens, &fakeEmailer{}, &fakeLimiter{}, true)
	_, api := humatest.New(t)
	registerResetPassword(api, d)
	resp := api.Post(
		"/auth/reset-password",
		map[string]any{"token": raw, "password": "brandnewpw", "confirmPassword": "brandnewpw"},
	)
	if resp.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204 (burn failure is best-effort); body = %s", resp.Code, resp.Body.String())
	}
}

// TestConfirmLoginEmailBurnFailureStill204 proves the credential-email token burn is
// best-effort too: a failed terminal consume after a successful add is logged, not surfaced.
func TestConfirmLoginEmailBurnFailureStill204(t *testing.T) {
	t.Parallel()
	store, tokens := newFakeUserStore(), newFakeTokens()
	store.add(sqlcdb.User{ID: "u1", Email: "oauth@example.com"}) // no password → add path
	tokens.consumeErr = errors.New("redis down")
	raw, _ := tokens.CreateCredentialEmail(t.Context(), "u1", "add@example.com")
	d := newFlowService(store, tokens, &fakeEmailer{}, &fakeLimiter{}, true)
	_, api := humatest.New(t)
	registerConfirmLoginEmail(api, d)
	resp := api.Post(
		"/auth/confirm-login-email",
		map[string]any{"token": raw, "password": "brandnewpw", "confirmPassword": "brandnewpw"},
	)
	if resp.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204 (burn failure is best-effort); body = %s", resp.Code, resp.Body.String())
	}
}

// --- confirm-login-email error legs ---

func TestConfirmLoginEmailMoreErrorPaths(t *testing.T) {
	t.Parallel()
	now := time.Unix(1_700_000_000, 0)

	t.Run("invalid password payload is a 422", func(t *testing.T) {
		t.Parallel()
		d := newFlowService(newFakeUserStore(), newFakeTokens(), &fakeEmailer{}, &fakeLimiter{}, true)
		_, api := humatest.New(t)
		registerConfirmLoginEmail(api, d)
		resp := api.Post(
			"/auth/confirm-login-email",
			map[string]any{"token": "x", "password": "short", "confirmPassword": "short"},
		)
		if resp.Code != http.StatusUnprocessableEntity {
			t.Fatalf("status = %d, want 422 (password below the 8-char minimum)", resp.Code)
		}
	})

	t.Run("transient user lookup leaves the token armed and 500s", func(t *testing.T) {
		t.Parallel()
		store, tokens := newFakeUserStore(), newFakeTokens()
		store.idErr = errors.New("connection refused") // non-NoRows → transient, not a deleted user
		raw, _ := tokens.CreateCredentialEmail(t.Context(), "u1", "fresh@example.com")
		d := newFlowService(store, tokens, &fakeEmailer{}, &fakeLimiter{}, true)
		_, api := humatest.New(t)
		registerConfirmLoginEmail(api, d)
		resp := api.Post("/auth/confirm-login-email", map[string]any{"token": raw})
		if resp.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", resp.Code)
		}
		// Peek-then-consume: a transient lookup failure never consumes the token.
		if _, ok := tokens.cred[raw]; !ok {
			t.Error("token should stay armed after a transient lookup failure")
		}
	})

	t.Run("add path without a password is a 422", func(t *testing.T) {
		t.Parallel()
		store, tokens := newFakeUserStore(), newFakeTokens()
		store.add(sqlcdb.User{ID: "u1", Email: "oauth@example.com"}) // no password → add path
		raw, _ := tokens.CreateCredentialEmail(t.Context(), "u1", "add@example.com")
		d := newFlowService(store, tokens, &fakeEmailer{}, &fakeLimiter{}, true)
		_, api := humatest.New(t)
		registerConfirmLoginEmail(api, d)
		resp := api.Post("/auth/confirm-login-email", map[string]any{"token": raw}) // no password submitted
		if resp.Code != http.StatusUnprocessableEntity {
			t.Fatalf("status = %d, want 422 (password required to finish adding sign-in)", resp.Code)
		}
	})

	t.Run("change write error still 500s", func(t *testing.T) {
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

	t.Run("add write error still 500s", func(t *testing.T) {
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

	t.Run("add succeeds even when the notification email fails", func(t *testing.T) {
		t.Parallel()
		store, tokens := newFakeUserStore(), newFakeTokens()
		store.add(sqlcdb.User{ID: "u1", Email: "oauth@example.com"}) // no password
		emailer := &fakeEmailer{err: errors.New("resend down")}
		raw, _ := tokens.CreateCredentialEmail(t.Context(), "u1", "add@example.com")
		d := newFlowService(store, tokens, emailer, &fakeLimiter{}, true)
		_, api := humatest.New(t)
		registerConfirmLoginEmail(api, d)
		resp := api.Post(
			"/auth/confirm-login-email",
			map[string]any{"token": raw, "password": "brandnewpw", "confirmPassword": "brandnewpw"},
		)
		if resp.Code != http.StatusNoContent {
			t.Fatalf("status = %d, want 204 (notify failure is best-effort); body = %s", resp.Code, resp.Body.String())
		}
	})
}

// TestAddCredentialEmailHashError drives addCredentialEmail's hashForStorage error via a
// direct call (the handler's 72-char cap would otherwise reject the over-long password).
func TestAddCredentialEmailHashError(t *testing.T) {
	t.Parallel()
	d := newFlowService(newFakeUserStore(), newFakeTokens(), &fakeEmailer{}, &fakeLimiter{}, true)
	user := sqlcdb.User{ID: "u1", Email: "oauth@example.com"}
	payload := CredentialEmailPayload{UserID: "u1", Email: "add@example.com", Gen: 1}

	_, err := d.addCredentialEmail(t.Context(), user, payload, overLongPassword)
	if !isHumaStatus(err, http.StatusInternalServerError) {
		t.Fatalf("addCredentialEmail(over-long pw) err = %v, want a 500 hash error", err)
	}
}

// TestPasswordHelpers pins the pure helper whose minority branches the flow tests
// don't otherwise reach.
func TestPasswordHelpers(t *testing.T) {
	t.Parallel()

	t.Run("isHumaStatus", func(t *testing.T) {
		t.Parallel()
		if !isHumaStatus(huma.Error409Conflict("taken"), http.StatusConflict) {
			t.Error("isHumaStatus(409, 409) = false, want true")
		}
		if isHumaStatus(huma.Error409Conflict("taken"), http.StatusInternalServerError) {
			t.Error("isHumaStatus(409, 500) = true, want false")
		}
		if isHumaStatus(errors.New("plain"), http.StatusConflict) {
			t.Error("isHumaStatus(non-huma, 409) = true, want false")
		}
	})
}

// TestForgotPasswordSendPaths covers the two send-side legs of forgot-password: a token
// mint failure (a returned error, logged best-effort) and a delivery failure (swallowed
// inside sendPasswordReset). Both keep the constant enumeration-safe 200.
func TestForgotPasswordSendPaths(t *testing.T) {
	t.Parallel()

	t.Run("token mint failure still 200s", func(t *testing.T) {
		t.Parallel()
		store, tokens := newFakeUserStore(), newFakeTokens()
		store.add(sqlcdb.User{ID: "u1", Email: "user@example.com", Password: new(hashPassword(t, "pw"))})
		tokens.createErr = errors.New("redis down")
		d := newFlowService(store, tokens, &fakeEmailer{}, &fakeLimiter{}, true)
		_, api := humatest.New(t)
		registerForgotPassword(api, d)
		resp := api.Post("/auth/forgot-password", map[string]any{"email": "user@example.com"})
		if resp.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", resp.Code)
		}
	})

	t.Run("delivery failure still 200s", func(t *testing.T) {
		t.Parallel()
		store := newFakeUserStore()
		store.add(sqlcdb.User{ID: "u1", Email: "user@example.com", Password: new(hashPassword(t, "pw"))})
		emailer := &fakeEmailer{err: errors.New("resend down")}
		d := newFlowService(store, newFakeTokens(), emailer, &fakeLimiter{}, true)
		_, api := humatest.New(t)
		registerForgotPassword(api, d)
		resp := api.Post("/auth/forgot-password", map[string]any{"email": "user@example.com"})
		if resp.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", resp.Code)
		}
	})
}

// --- verify-email error legs ---

func TestVerifyEmailErrorPaths(t *testing.T) {
	t.Parallel()

	t.Run("rate limited is a 429", func(t *testing.T) {
		t.Parallel()
		lim := &fakeLimiter{deny: map[string]bool{ratelimit.BucketVerifyEmail: true}, retryAfter: time.Minute}
		d := newFlowService(newFakeUserStore(), newFakeTokens(), &fakeEmailer{}, lim, true)
		_, api := humatest.New(t)
		registerVerifyEmail(api, d)
		resp := api.Post("/auth/verify-email", map[string]any{"token": "x"})
		if resp.Code != http.StatusTooManyRequests {
			t.Fatalf("status = %d, want 429", resp.Code)
		}
	})

	t.Run("token read failure is a 500", func(t *testing.T) {
		t.Parallel()
		tokens := newFakeTokens()
		tokens.verifyPeekErr = errors.New("redis down")
		d := newFlowService(newFakeUserStore(), tokens, &fakeEmailer{}, &fakeLimiter{}, true)
		_, api := humatest.New(t)
		registerVerifyEmail(api, d)
		resp := api.Post("/auth/verify-email", map[string]any{"token": "x"})
		if resp.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", resp.Code)
		}
	})

	t.Run("mark-verified write failure is a 500 and the link stays armed", func(t *testing.T) {
		t.Parallel()
		store, tokens := newFakeUserStore(), newFakeTokens()
		store.add(sqlcdb.User{ID: "u1", Email: "user@example.com"}) // unverified
		store.markVerifiedErr = errors.New("connection refused")
		raw, _ := tokens.CreateVerification(t.Context(), "user@example.com")
		d := newFlowService(store, tokens, &fakeEmailer{}, &fakeLimiter{}, true)
		_, api := humatest.New(t)
		registerVerifyEmail(api, d)
		resp := api.Post("/auth/verify-email", map[string]any{"token": raw})
		if resp.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", resp.Code)
		}
		// Peek-then-consume: a transient mark failure never burns the token, so the
		// emailed link is still usable once the DB recovers (no compensating restore).
		if _, ok := tokens.verify[raw]; !ok {
			t.Error("token should stay armed after a transient mark failure")
		}
	})

	t.Run("token burn failure after verify is still 204", func(t *testing.T) {
		t.Parallel()
		store, tokens := newFakeUserStore(), newFakeTokens()
		store.add(sqlcdb.User{ID: "u1", Email: "user@example.com"}) // unverified
		tokens.verifyBurnErr = errors.New("redis down")
		raw, _ := tokens.CreateVerification(t.Context(), "user@example.com")
		d := newFlowService(store, tokens, &fakeEmailer{}, &fakeLimiter{}, true)
		_, api := humatest.New(t)
		registerVerifyEmail(api, d)
		resp := api.Post("/auth/verify-email", map[string]any{"token": raw})
		// The mark succeeded; a best-effort burn failure is logged, not surfaced.
		if resp.Code != http.StatusNoContent {
			t.Fatalf("status = %d, want 204", resp.Code)
		}
		if store.byEmail["user@example.com"].EmailVerified == nil {
			t.Error("email was not marked verified")
		}
	})
}

// TestRegisterNudgeMintErrors covers nudgeExistingAccount's two error returns: an
// existing OAuth-only account whose reset-mint fails, and an existing unverified account
// whose verification-mint fails. Both surface as a 500 from register.
func TestRegisterNudgeMintErrors(t *testing.T) {
	t.Parallel()

	t.Run("oauth-only reset mint failure is a 500", func(t *testing.T) {
		t.Parallel()
		store, tokens := newFakeUserStore(), newFakeTokens()
		store.add(sqlcdb.User{ID: "u1", Email: "oauth@example.com"}) // no password → reset nudge
		tokens.createErr = errors.New("redis down")
		d := newFlowService(store, tokens, &fakeEmailer{}, &fakeLimiter{}, true)
		_, api := humatest.New(t)
		registerRegister(api, d)
		resp := api.Post("/auth/register", map[string]any{
			"name": "Ada", "email": "oauth@example.com", "password": "longenough", "confirmPassword": "longenough",
		})
		if resp.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", resp.Code)
		}
	})

	t.Run("unverified verification mint failure is a 500", func(t *testing.T) {
		t.Parallel()
		store, tokens := newFakeUserStore(), newFakeTokens()
		// Has a password but unverified → verification-resend nudge.
		store.add(sqlcdb.User{ID: "u1", Email: "pending@example.com", Password: new(hashPassword(t, "pw"))})
		tokens.createErr = errors.New("redis down")
		d := newFlowService(store, tokens, &fakeEmailer{}, &fakeLimiter{}, true)
		_, api := humatest.New(t)
		registerRegister(api, d)
		resp := api.Post("/auth/register", map[string]any{
			"name": "Ada", "email": "pending@example.com", "password": "longenough", "confirmPassword": "longenough",
		})
		if resp.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", resp.Code)
		}
	})
}

// TestRegisterNewUserDeliveryFailureStill200 proves a verification-email delivery failure
// is swallowed: the account is created and the pending redirect still returns 200.
func TestRegisterNewUserDeliveryFailureStill200(t *testing.T) {
	t.Parallel()
	store := newFakeUserStore()
	emailer := &fakeEmailer{err: errors.New("resend down")}
	d := newFlowService(store, newFakeTokens(), emailer, &fakeLimiter{}, true)
	_, api := humatest.New(t)
	registerRegister(api, d)
	resp := api.Post("/auth/register", map[string]any{
		"name": "Ada", "email": "new@example.com", "password": "longenough", "confirmPassword": "longenough",
	})
	if resp.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (delivery failure swallowed); body = %s", resp.Code, resp.Body.String())
	}
	if _, ok := store.byEmail["new@example.com"]; !ok {
		t.Error("account should still be created when the verification email fails to send")
	}
}

// TestRegisterInsertHardErrorIs500 covers recoverInsertRace's non-unique branch: an
// insert failure that is NOT a 23505 propagates as a 500 rather than a race recovery.
func TestRegisterInsertHardErrorIs500(t *testing.T) {
	t.Parallel()
	store := newFakeUserStore()
	store.insertErr = errors.New("connection refused")
	d := newFlowService(store, newFakeTokens(), &fakeEmailer{}, &fakeLimiter{}, true)
	_, api := humatest.New(t)
	registerRegister(api, d)
	resp := api.Post("/auth/register", map[string]any{
		"name": "Ada", "email": "new@example.com", "password": "longenough", "confirmPassword": "longenough",
	})
	if resp.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", resp.Code)
	}
}

// TestRegisterFindsExistingViaVerifiedCredentialEmail covers findUserByAnyEmail's second
// lookup leg: an account discoverable only by its verified credential email.
func TestRegisterFindsExistingViaVerifiedCredentialEmail(t *testing.T) {
	t.Parallel()
	now := time.Unix(1_700_000_000, 0)
	store, emailer := newFakeUserStore(), &fakeEmailer{}
	// Fully set-up account: primary email differs from the credential email we register with.
	store.add(sqlcdb.User{
		ID: "u1", Email: "primary@example.com", Password: new(hashPassword(t, "pw")), EmailVerified: &now,
		CredentialEmail: new("cred@example.com"), CredentialEmailVerified: &now,
	})
	d := newFlowService(store, newFakeTokens(), emailer, &fakeLimiter{}, true)
	_, api := humatest.New(t)
	registerRegister(api, d)
	resp := api.Post("/auth/register", map[string]any{
		"name": "Ada", "email": "cred@example.com", "password": "longenough", "confirmPassword": "longenough",
	})
	if resp.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body = %s", resp.Code, resp.Body.String())
	}
	// Fully set-up account → the nudge stays silent.
	if len(emailer.verifications)+len(emailer.resets) != 0 {
		t.Error("a fully-set-up account found via credential email should trigger no email")
	}
}

// TestResendVerificationRecentlySentErrorIs500 covers the anti-spam-check error leg: a
// failure reading the recently-sent marker surfaces as a 500.
func TestResendVerificationRecentlySentErrorIs500(t *testing.T) {
	t.Parallel()
	store, tokens := newFakeUserStore(), newFakeTokens()
	store.add(sqlcdb.User{ID: "u1", Email: "user@example.com"}) // unverified
	tokens.recentSentErr = errors.New("redis down")
	d := newFlowService(store, tokens, &fakeEmailer{}, &fakeLimiter{}, true)
	_, api := humatest.New(t)
	registerResendVerification(api, d)
	resp := api.Post("/auth/resend-verification", map[string]any{"email": "user@example.com"})
	if resp.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", resp.Code)
	}
}
