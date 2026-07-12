package auth

import (
	"context"
	"errors"
	"net/http"
	"net/url"

	"github.com/danielgtaylor/huma/v2"
	"github.com/jackc/pgx/v5"

	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
	"github.com/o-mishch/devstash/backend/internal/middleware"
	"github.com/o-mishch/devstash/backend/internal/ratelimit"
)

const invalidResetMessage = "This reset link is invalid or has expired."

type forgotPasswordInput struct {
	Body struct {
		Email string `doc:"Account email" format:"email" json:"email" required:"true"`
	}
}

// registerForgotPassword wires POST /auth/forgot-password. Always 200 with a
// constant redirect (enumeration-safe); emails a reset link only if the account
// exists, to its own primary address.
func registerForgotPassword(api huma.API, s *Service) {
	huma.Register(api, huma.Operation{
		OperationID: "auth-forgot-password",
		Method:      http.MethodPost,
		Path:        "/auth/forgot-password",
		Summary:     "Request a password reset link",
		Tags:        []string{tagAuth},
	}, func(ctx context.Context, in *forgotPasswordInput) (*redirectOutput, error) {
		ip := middleware.RemoteIP(ctx)
		if err := s.enforceLimit(ctx, ratelimit.BucketForgotPassword, ip); err != nil {
			return nil, err
		}
		email := normalizeEmail(in.Body.Email)

		// Best-effort: a delivery failure must not change the (constant) response.
		if user, found, err := s.findUserByAnyEmail(ctx, email); err != nil {
			s.Logger.ErrorContext(ctx, "forgot-password: lookup failed", "err", err)
		} else if found {
			if err := s.sendPasswordReset(ctx, user.Email); err != nil {
				s.Logger.ErrorContext(ctx, "forgot-password: send failed", "err", err)
			}
		}

		out := &redirectOutput{}
		q := url.Values{"sent": {"1"}, "email": {email}}
		out.Body.RedirectTo = "/forgot-password?" + q.Encode()
		return out, nil
	})
}

type resetPasswordInput struct {
	Body struct {
		Token           string `doc:"Reset token from the email link" json:"token"           minLength:"1"   required:"true"`
		Password        string `doc:"New password"                    json:"password"        maxLength:"128" minLength:"1"   required:"true"`
		ConfirmPassword string `doc:"Repeat new password"             json:"confirmPassword" maxLength:"128" minLength:"1"   required:"true"`
	}
}

// registerResetPassword wires POST /auth/reset-password. 204 on success; 400 for an
// invalid/expired token or an email collision on the bootstrap path.
func registerResetPassword(api huma.API, s *Service) {
	huma.Register(api, huma.Operation{
		OperationID:   "auth-reset-password",
		Method:        http.MethodPost,
		Path:          "/auth/reset-password",
		Summary:       "Reset a password with a token",
		Tags:          []string{tagAuth},
		DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, in *resetPasswordInput) (*noContent, error) {
		ip := middleware.RemoteIP(ctx)
		if err := s.enforceLimit(ctx, ratelimit.BucketResetPassword, ip); err != nil {
			return nil, err
		}
		password, err := validateNewPassword(in.Body.Password, in.Body.ConfirmPassword)
		if err != nil {
			return nil, err
		}

		ok, err := s.applyPasswordReset(ctx, in.Body.Token, password)
		if err != nil {
			s.Logger.ErrorContext(ctx, "reset-password failed", "err", err)
			return nil, huma.Error500InternalServerError(genericErrorMessage)
		}
		if !ok {
			return nil, huma.Error400BadRequest(invalidResetMessage)
		}
		return &noContent{}, nil
	})
}

// applyPasswordReset validates the reset token (non-destructively), updates the password
// by prior state, and burns the token only once the outcome is terminal — so a transient
// failure mid-flow leaves the emailed link usable for a retry (no compensating restore).
// ok=false means the token was invalid/expired, the account is gone, or the email collided.
func (s *Service) applyPasswordReset(ctx context.Context, token, password string) (bool, error) {
	email, ok, err := s.Tokens.PeekPasswordReset(ctx, token)
	if err != nil {
		return false, err
	}
	if !ok {
		return false, nil
	}

	user, err := s.Users.GetUserByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// The account is gone: burn the dead link and report invalid.
			s.consumePasswordResetToken(ctx, token)
			return false, nil
		}
		return false, err // transient: leave the link armed for a retry
	}

	hash, err := hashForStorage(password)
	if err != nil {
		return false, err // leave the link armed
	}

	hadPassword := user.Password != nil
	collision, err := s.persistPasswordReset(ctx, user, hash, email)
	if err != nil {
		return false, err // leave the link armed
	}
	if collision {
		// The credential email was taken concurrently — a retry can't succeed, so burn it.
		s.consumePasswordResetToken(ctx, token)
		return false, nil
	}

	// Success: burn the single-use token.
	s.consumePasswordResetToken(ctx, token)

	event := SecurityPasswordReset
	if !hadPassword {
		event = SecurityCredentialEmailAdded
	}
	if err := s.Email.SendSecurityNotification(ctx, user.Email, event); err != nil {
		s.Logger.ErrorContext(ctx, "reset-password: notify failed", "err", err)
	}
	s.Logger.InfoContext(ctx, "password reset applied", "userID", user.ID, "hadPassword", hadPassword)
	return true, nil
}

// persistPasswordReset writes the new password by the account's prior state. It
// returns collision=true when the bootstrap path hits a unique violation.
func (s *Service) persistPasswordReset(ctx context.Context, user sqlcdb.User, hash, email string) (bool, error) {
	switch {
	case user.Password == nil:
		// OAuth-only: set the password and verify both emails in lockstep. A unique
		// violation means the credential email was taken concurrently — report it as a
		// collision (not an error); any other failure propagates.
		if err := s.Users.BootstrapCredentialLogin(ctx, sqlcdb.BootstrapCredentialLoginParams{
			ID: user.ID, Password: &hash, CredentialEmail: &email,
		}); err != nil {
			if isUniqueViolation(err) {
				return true, nil
			}
			return false, err
		}
	case user.EmailVerified == nil:
		// Has a password but unverified: set password + verify.
		if err := s.Users.SetPasswordAndVerifyEmail(ctx, sqlcdb.SetPasswordAndVerifyEmailParams{
			ID: user.ID, Password: &hash, CredentialEmail: &email,
		}); err != nil {
			return false, err
		}
	default:
		if err := s.Users.UpdateUserPassword(ctx, sqlcdb.UpdateUserPasswordParams{
			ID: user.ID, Password: &hash,
		}); err != nil {
			return false, err
		}
	}
	return false, nil
}

const (
	invalidConfirmMessage   = "This confirmation link is invalid or has expired."
	credentialInUseMessage  = "That email is already in use. This link has been used — request a new confirmation link from your profile." // #nosec G101
	passwordRequiredMessage = "A password is required to finish adding Email & Password sign-in to your account."
)

type confirmLoginEmailInput struct {
	Body struct {
		Token           string `doc:"Confirmation token from the email link"       json:"token"                     minLength:"1"   required:"true"`
		Password        string `doc:"Password (required only when adding sign-in)" json:"password,omitempty"        maxLength:"128"`
		ConfirmPassword string `doc:"Repeat password"                              json:"confirmPassword,omitempty" maxLength:"128"`
	}
}

// registerConfirmLoginEmail wires POST /auth/confirm-login-email. Re-points or adds
// the credential sign-in email. 204 ok; 409 email-in-use; 422 password-required;
// 400 invalid/expired.
func registerConfirmLoginEmail(api huma.API, s *Service) {
	huma.Register(api, huma.Operation{
		OperationID:   "auth-confirm-login-email",
		Method:        http.MethodPost,
		Path:          "/auth/confirm-login-email",
		Summary:       "Confirm a credential sign-in email",
		Tags:          []string{tagAuth},
		DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, in *confirmLoginEmailInput) (*noContent, error) {
		ip := middleware.RemoteIP(ctx)
		if err := s.enforceLimit(ctx, ratelimit.BucketConfirmLoginEmail, ip); err != nil {
			return nil, err
		}

		var password string
		if in.Body.Password != "" || in.Body.ConfirmPassword != "" {
			var err error
			password, err = validateNewPassword(in.Body.Password, in.Body.ConfirmPassword)
			if err != nil {
				return nil, err
			}
		}

		return s.confirmCredentialEmail(ctx, in.Body.Token, password)
	})
}

// confirmCredentialEmail applies a credential-email token: change (has password) or add
// (no password + a submitted password). The token is validated non-destructively (Peek)
// and burned only once the update reaches a terminal outcome, so a transient failure
// leaves the emailed link armed for a retry (no compensating restore). Returns the mapped
// Huma error.
func (s *Service) confirmCredentialEmail(ctx context.Context, token, password string) (*noContent, error) {
	payload, ok, err := s.Tokens.PeekCredentialEmail(ctx, token)
	if err != nil {
		s.Logger.ErrorContext(ctx, "confirm-login-email: peek failed", "err", err)
		return nil, huma.Error500InternalServerError(genericErrorMessage)
	}
	if !ok {
		return nil, huma.Error400BadRequest(invalidConfirmMessage)
	}

	user, err := s.Users.GetUserByID(ctx, payload.UserID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// The account is gone: burn the dead link and report invalid.
			s.consumeCredentialEmailToken(ctx, token, payload)
			return nil, huma.Error400BadRequest(invalidConfirmMessage)
		}
		s.Logger.ErrorContext(ctx, "confirm-login-email: user lookup failed", "err", err)
		return nil, huma.Error500InternalServerError(genericErrorMessage) // transient: leave armed
	}

	return s.processCredentialEmailUpdate(ctx, token, user, payload, password)
}

// processCredentialEmailUpdate resolves the update based on password existence, burning
// the token on any terminal outcome (success, or a permanent 409 conflict) and leaving it
// armed otherwise — a transient write error, or a missing password the caller can resupply.
func (s *Service) processCredentialEmailUpdate(
	ctx context.Context,
	token string,
	user sqlcdb.User,
	payload CredentialEmailPayload,
	password string,
) (*noContent, error) {
	if user.Password != nil {
		ret, err := s.changeCredentialEmail(ctx, user, payload)
		if err == nil || isHumaStatus(err, http.StatusConflict) {
			s.consumeCredentialEmailToken(ctx, token, payload)
		}
		return ret, err
	}
	if password == "" {
		// The same link works once a password is supplied — leave it armed for the retry.
		return nil, huma.Error422UnprocessableEntity(passwordRequiredMessage)
	}
	ret, err := s.addCredentialEmail(ctx, user, payload, password)
	if err == nil || isHumaStatus(err, http.StatusConflict) {
		s.consumeCredentialEmailToken(ctx, token, payload)
	}
	return ret, err
}

// changeCredentialEmail re-points an existing credential email (user has a password).
func (s *Service) changeCredentialEmail(
	ctx context.Context,
	user sqlcdb.User,
	payload CredentialEmailPayload,
) (*noContent, error) {
	if err := s.Users.ChangeCredentialEmail(ctx, sqlcdb.ChangeCredentialEmailParams{
		ID: user.ID, CredentialEmail: &payload.Email,
	}); err != nil {
		return nil, s.mapCredentialWriteError(ctx, "change", err)
	}
	// Notify the previous login address.
	previous := user.Email
	if user.CredentialEmail != nil {
		previous = *user.CredentialEmail
	}
	if err := s.Email.SendSecurityNotification(ctx, previous, SecurityCredentialEmailChanged); err != nil {
		s.Logger.ErrorContext(ctx, "confirm-login-email: notify failed", "err", err)
	}
	s.Logger.InfoContext(ctx, "credential login email changed", "userID", user.ID)
	return &noContent{}, nil
}

// addCredentialEmail sets a password + verified credential email for an OAuth-only account.
func (s *Service) addCredentialEmail(
	ctx context.Context,
	user sqlcdb.User,
	payload CredentialEmailPayload,
	password string,
) (*noContent, error) {
	hash, err := hashForStorage(password)
	if err != nil {
		return nil, huma.Error500InternalServerError(genericErrorMessage)
	}
	if err := s.Users.SetCredentialEmailLogin(ctx, sqlcdb.SetCredentialEmailLoginParams{
		ID: user.ID, Password: &hash, CredentialEmail: &payload.Email,
	}); err != nil {
		return nil, s.mapCredentialWriteError(ctx, "add", err)
	}
	if err := s.Email.SendSecurityNotification(ctx, user.Email, SecurityCredentialEmailAdded); err != nil {
		s.Logger.ErrorContext(ctx, "confirm-login-email: notify failed", "err", err)
	}
	s.Logger.InfoContext(ctx, "credential login email added", "userID", user.ID)
	return &noContent{}, nil
}

func (s *Service) mapCredentialWriteError(ctx context.Context, op string, err error) error {
	if isUniqueViolation(err) {
		return huma.Error409Conflict(credentialInUseMessage)
	}
	s.Logger.ErrorContext(ctx, "confirm-login-email: "+op+" failed", "err", err)
	return huma.Error500InternalServerError(genericErrorMessage)
}

// isHumaStatus reports whether err carries the given HTTP status. It matches on
// huma.StatusError (the exported interface every huma.Error* value implements via
// GetStatus) rather than an ad-hoc anonymous interface, so the method name is
// compiler-checked against Huma and errors.As unwraps a wrapped error too.
func isHumaStatus(err error, status int) bool {
	var se huma.StatusError
	return errors.As(err, &se) && se.GetStatus() == status
}

// consumePasswordResetToken burns a reset token once the reset reaches a terminal
// outcome. Best-effort: a failed delete only leaves a soon-to-expire key behind, so it is
// logged rather than surfaced.
func (s *Service) consumePasswordResetToken(ctx context.Context, token string) {
	if err := s.Tokens.ConsumePasswordReset(ctx, token); err != nil {
		s.Logger.ErrorContext(ctx, "reset-password: consume token failed", "err", err)
	}
}

// consumeCredentialEmailToken burns a credential-email token once the update reaches a
// terminal outcome. Best-effort: a failed (or already-won, under a concurrent redemption)
// consume is logged, not surfaced.
func (s *Service) consumeCredentialEmailToken(ctx context.Context, token string, payload CredentialEmailPayload) {
	if _, err := s.Tokens.ConsumeCredentialEmail(ctx, token, payload); err != nil {
		s.Logger.ErrorContext(ctx, "confirm-login-email: consume token failed", "err", err)
	}
}
