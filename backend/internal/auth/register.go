package auth

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/crypto/bcrypt"

	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
	"github.com/o-mishch/devstash/backend/internal/middleware"
	"github.com/o-mishch/devstash/backend/internal/ratelimit"
)

// registerInput is the sign-up request. Field-level length is validated by Huma;
// password strength (min 8, post-trim) and the confirm match run in the handler.
type registerInput struct {
	Body struct {
		Name            string `doc:"Display name"     json:"name"            maxLength:"64"  minLength:"1"   required:"true"`
		Email           string `doc:"Account email"    format:"email"         json:"email"    required:"true"`
		Password        string `doc:"Account password" json:"password"        maxLength:"128" minLength:"1"   required:"true"`
		ConfirmPassword string `doc:"Repeat password"  json:"confirmPassword" maxLength:"128" minLength:"1"   required:"true"`
	}
}

type redirectOutput struct {
	Body struct {
		RedirectTo string `json:"redirectTo"`
	}
}

// registerRegister wires POST /auth/register. It never logs the user in; it returns
// a redirect target and (enumeration-safely) sends at most one email.
func registerRegister(api huma.API, s *Service) {
	huma.Register(api, huma.Operation{
		OperationID: "auth-register",
		Method:      http.MethodPost,
		Path:        "/auth/register",
		Summary:     "Register a new account",
		Tags:        []string{tagAuth},
	}, func(ctx context.Context, in *registerInput) (*redirectOutput, error) {
		ip := middleware.RemoteIP(ctx)
		if err := s.enforceLimit(ctx, ratelimit.BucketRegister, ip); err != nil {
			return nil, err
		}

		name := strings.TrimSpace(in.Body.Name)
		email := normalizeEmail(in.Body.Email)
		// Length is capped by Huma (maxLength:64) before the handler runs; only the
		// trim-to-empty case can still occur here.
		if len(name) == 0 {
			return nil, huma.Error422UnprocessableEntity("Please enter a name (max 64 characters).")
		}
		password, err := validateNewPassword(in.Body.Password, in.Body.ConfirmPassword)
		if err != nil {
			return nil, err
		}

		emailInUse, err := s.registerUser(ctx, name, email, password)
		if err != nil {
			s.Logger.ErrorContext(ctx, "register failed", "err", err)
			return nil, huma.Error500InternalServerError(genericErrorMessage)
		}
		if emailInUse {
			return nil, huma.Error409Conflict("This email is already in use.")
		}

		s.Logger.InfoContext(ctx, "registration succeeded", "email", email)

		out := &redirectOutput{}
		out.Body.RedirectTo = registerRedirect(s.Cfg.OutboundEmailEnabled, email)
		return out, nil
	})
}

// registerUser reproduces the Next app's registerUser: create a new account or,
// enumeration-safely, nudge an existing one via email. emailInUse is true only on
// the verification-disabled collision path (the handler maps it to 409).
func (s *Service) registerUser(ctx context.Context, name, email, password string) (bool, error) {
	existing, found, err := s.findUserByAnyEmail(ctx, email)
	if err != nil {
		return false, err
	}
	if found {
		// Spend one constant-cost bcrypt operation to equalize timing.
		_ = bcrypt.CompareHashAndPassword([]byte(dummyPasswordHash), []byte(password))
		return s.nudgeExistingAccount(ctx, existing)
	}

	hash, err := hashForStorage(password)
	if err != nil {
		return false, err
	}
	var verified *time.Time
	if !s.Cfg.OutboundEmailEnabled {
		now := time.Now()
		verified = &now
	}
	user, err := s.Users.InsertCredentialUser(ctx, sqlcdb.InsertCredentialUserParams{
		ID:                      s.IDs(),
		Email:                   email,
		Name:                    &name,
		Password:                &hash,
		EmailVerified:           verified,
		CredentialEmail:         &email,
		CredentialEmailVerified: verified,
	})
	if err != nil {
		return s.recoverInsertRace(ctx, email, err)
	}

	if s.Cfg.OutboundEmailEnabled {
		if err := s.sendVerification(ctx, user.Email); err != nil {
			return false, err
		}
	}
	return false, nil
}

// recoverInsertRace handles a failed InsertCredentialUser. A unique violation means
// a concurrent request created the account — re-resolve and fall back to the nudge
// path; any other error propagates.
func (s *Service) recoverInsertRace(ctx context.Context, email string, insertErr error) (bool, error) {
	if !isUniqueViolation(insertErr) {
		return false, insertErr
	}
	raced, found, err := s.findUserByAnyEmail(ctx, email)
	if err != nil {
		return false, err
	}
	if !found {
		return false, insertErr
	}
	return s.nudgeExistingAccount(ctx, raced)
}

// nudgeExistingAccount handles an account that already exists. With verification
// disabled it reports emailInUse (→ 409); otherwise it sends the enumeration-safe
// email to the account's own primary address (never the typed one) and reports false.
func (s *Service) nudgeExistingAccount(ctx context.Context, user sqlcdb.User) (bool, error) {
	if !s.Cfg.OutboundEmailEnabled {
		return true, nil
	}
	switch {
	case user.Password == nil:
		// OAuth-only account: offer to set a password via the reset flow.
		if err := s.sendPasswordReset(ctx, user.Email); err != nil {
			return false, err
		}
		return false, nil
	case user.EmailVerified == nil:
		// Has a password but unverified: resend the verification email.
		if err := s.sendVerification(ctx, user.Email); err != nil {
			return false, err
		}
		return false, nil
	default:
		// Fully set up: say nothing (the response is identical either way).
		return false, nil
	}
}

// findUserByAnyEmail resolves an account by primary email, then verified credential
// email, then a linked OAuth account email. Parity: findUserByAnyEmail.
func (s *Service) findUserByAnyEmail(ctx context.Context, email string) (sqlcdb.User, bool, error) {
	lookups := []func() (sqlcdb.User, error){
		func() (sqlcdb.User, error) { return s.Users.GetUserByEmail(ctx, email) },
		func() (sqlcdb.User, error) { return s.Users.GetUserByVerifiedCredentialEmail(ctx, &email) },
		func() (sqlcdb.User, error) { return s.Users.GetUserByAccountEmail(ctx, &email) },
	}
	for lookup := range slices.Values(lookups) {
		if u, found, err := tryLookup(lookup); err != nil || found {
			return u, found, err
		}
	}
	return sqlcdb.User{}, false, nil
}

// sendVerification mints a verification token and emails the confirmation link.
func (s *Service) sendVerification(ctx context.Context, email string) error {
	raw, err := s.Tokens.CreateVerification(ctx, email)
	if err != nil {
		return err
	}
	if err := s.Email.SendVerification(ctx, email, s.actionURL("/verify-email", raw)); err != nil {
		s.Logger.ErrorContext(ctx, "sendVerification: email delivery failed", "err", err, "email", email)
		return nil
	}
	if err := s.Tokens.SetVerificationSent(ctx, email); err != nil {
		// Best-effort anti-spam marker: the account exists and the email already went
		// out, so a marker-write blip must not surface as a registration failure.
		s.Logger.ErrorContext(ctx, "sendVerification: sent-marker write failed", "err", err, "email", email)
	}
	return nil
}

// sendPasswordReset mints a reset token and emails the reset link.
func (s *Service) sendPasswordReset(ctx context.Context, email string) error {
	raw, err := s.Tokens.CreatePasswordReset(ctx, email)
	if err != nil {
		return err
	}
	if err := s.Email.SendPasswordReset(ctx, email, s.actionURL("/reset-password", raw)); err != nil {
		s.Logger.ErrorContext(ctx, "sendPasswordReset: email delivery failed", "err", err, "email", email)
		return nil
	}
	return nil
}

type verifyEmailInput struct {
	Body struct {
		Token string `doc:"Verification token from the email link" json:"token" minLength:"1" required:"true"`
	}
}

// registerVerifyEmail wires POST /auth/verify-email — the SPA posts the token from
// the emailed link. Always 204 (invalid/expired tokens are indistinguishable).
func registerVerifyEmail(api huma.API, s *Service) {
	huma.Register(api, huma.Operation{
		OperationID:   "auth-verify-email",
		Method:        http.MethodPost,
		Path:          "/auth/verify-email",
		Summary:       "Confirm an email verification token",
		Tags:          []string{tagAuth},
		DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, in *verifyEmailInput) (*noContent, error) {
		ip := middleware.RemoteIP(ctx)
		if err := s.enforceLimit(ctx, ratelimit.BucketVerifyEmail, ip); err != nil {
			return nil, err
		}

		// Peek-then-consume: validate the token non-destructively, mark verified (idempotent
		// via the query's WHERE emailVerified IS NULL), then burn the link only on success.
		// A transient mark-write failure therefore leaves the emailed link armed for a retry
		// instead of stranding the account unverified behind a still-set anti-spam marker.
		email, ok, err := s.Tokens.PeekVerification(ctx, in.Body.Token)
		if err != nil {
			s.Logger.ErrorContext(ctx, "verify-email: peek token failed", "err", err)
			return nil, huma.Error500InternalServerError(genericErrorMessage)
		}
		if ok {
			if err := s.Users.MarkEmailVerifiedByEmail(ctx, email); err != nil {
				s.Logger.ErrorContext(ctx, "verify-email: mark verified failed", "err", err)
				return nil, huma.Error500InternalServerError(genericErrorMessage) // transient: leave armed
			}
			if err := s.Tokens.ConsumeVerification(ctx, in.Body.Token); err != nil {
				// Best-effort burn: the mark already succeeded and the key self-expires.
				s.Logger.ErrorContext(ctx, "verify-email: consume token failed", "err", err)
			}
			s.Logger.InfoContext(ctx, "email verified", "email", email)
		}
		return &noContent{}, nil
	})
}

type resendVerificationInput struct {
	Body struct {
		Email string `doc:"Account email" format:"email" json:"email" required:"true"`
	}
}

// registerResendVerification wires POST /auth/resend-verification. Always 204
// (enumeration-safe); rate-limited by IP then IP+email; respects the anti-spam
// sent-marker window.
func registerResendVerification(api huma.API, s *Service) {
	huma.Register(api, huma.Operation{
		OperationID:   "auth-resend-verification",
		Method:        http.MethodPost,
		Path:          "/auth/resend-verification",
		Summary:       "Resend the email verification link",
		Tags:          []string{tagAuth},
		DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, in *resendVerificationInput) (*noContent, error) {
		ip := middleware.RemoteIP(ctx)
		if err := s.enforceLimit(ctx, ratelimit.BucketResendVerificationIP, ip); err != nil {
			return nil, err
		}
		email := normalizeEmail(in.Body.Email)
		if err := s.enforceLimit(ctx, ratelimit.BucketResendVerification, ip+":"+email); err != nil {
			return nil, err
		}
		if err := s.resendVerification(ctx, email); err != nil {
			s.Logger.ErrorContext(ctx, "resend-verification failed", "err", err)
			return nil, huma.Error500InternalServerError(genericErrorMessage)
		}
		return &noContent{}, nil
	})
}

// resendVerification re-sends a verification email for an unverified credential
// account, unless one was sent recently (anti-spam window).
func (s *Service) resendVerification(ctx context.Context, email string) error {
	// The query filters "emailVerified" IS NULL, so a row means an unverified account
	// exists; a verified or absent one is ErrNoRows.
	if _, err := s.Users.GetUnverifiedUserByEmail(ctx, email); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil // no such unverified account — say nothing
		}
		return err
	}
	recent, err := s.Tokens.VerificationRecentlySent(ctx, email)
	if err != nil {
		return err
	}
	if recent {
		return nil
	}
	return s.sendVerification(ctx, email)
}

// registerRedirect builds the post-register redirect target (relative path).
func registerRedirect(outboundEmail bool, email string) string {
	if !outboundEmail {
		return "/sign-in"
	}
	q := url.Values{"pending": {"1"}, "email": {email}, "sent": {"1"}}
	return "/register?" + q.Encode()
}

// actionURL builds an absolute link into the SPA for an emailed token.
func (s *Service) actionURL(path, token string) string {
	q := url.Values{"token": {token}}
	return strings.TrimRight(s.Cfg.AppURL, "/") + path + "?" + q.Encode()
}

// isUniqueViolation reports whether err is a Postgres unique-constraint violation.
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
