// Package auth implements the DevStash authentication surface as Huma operations:
// credential login, the session probe, logout, registration/verification, password
// recovery, and OAuth (added per flow). Files are cohesive by flow (login.go,
// register.go, password.go, oauth.go, tokens.go) rather than one-per-endpoint.
//
// Collaborators are injected as Deps (the exported constructor input) and held on an
// unexported-field *Service that owns every operation's behaviour; each dependency
// sits behind a narrow, consumer-defined interface so handlers test against in-memory
// fakes. Session resolution and the Operation.Security enforcement live in
// internal/middleware; the session envelope (fingerprint, idle) lives in internal/session.
package auth

import (
	"context"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"

	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
	"github.com/o-mishch/devstash/backend/internal/ratelimit"
)

// UserStore is the auth domain's data interface, satisfied by the sqlc *Queries in
// production and an in-memory fake in tests. It is auth-scoped (not a global
// Querier): only the reads and writes the auth flows perform. Every mutation is
// keyed by a server-derived id/email, never raw user input (IDOR-safe).
type UserStore interface {
	GetUserByID(ctx context.Context, id string) (sqlcdb.User, error)
	GetUserByEmail(ctx context.Context, email string) (sqlcdb.User, error)
	GetUserByVerifiedCredentialEmail(ctx context.Context, credentialEmail *string) (sqlcdb.User, error)
	GetUserByAccountEmail(ctx context.Context, email *string) (sqlcdb.User, error)
	GetUnverifiedUserByEmail(ctx context.Context, email string) (sqlcdb.GetUnverifiedUserByEmailRow, error)
	InsertCredentialUser(ctx context.Context, arg sqlcdb.InsertCredentialUserParams) (sqlcdb.User, error)
	UpdateUserPassword(ctx context.Context, arg sqlcdb.UpdateUserPasswordParams) error
	BootstrapCredentialLogin(ctx context.Context, arg sqlcdb.BootstrapCredentialLoginParams) error
	SetPasswordAndVerifyEmail(ctx context.Context, arg sqlcdb.SetPasswordAndVerifyEmailParams) error
	MarkEmailVerifiedByEmail(ctx context.Context, email string) error
	ChangeCredentialEmail(ctx context.Context, arg sqlcdb.ChangeCredentialEmailParams) error
	SetCredentialEmailLogin(ctx context.Context, arg sqlcdb.SetCredentialEmailLoginParams) error
	// OAuth: the (provider, providerAccountId) → account lookup, the conflict probe, and
	// the new-user / account writes. Reads are keyed by provider-supplied identifiers;
	// writes attach to a server-resolved userId, never raw user input (IDOR-safe).
	GetProviderAccount(ctx context.Context, arg sqlcdb.GetProviderAccountParams) (sqlcdb.Account, error)
	GetUserWithOAuthConflict(
		ctx context.Context,
		arg sqlcdb.GetUserWithOAuthConflictParams,
	) (sqlcdb.GetUserWithOAuthConflictRow, error)
	CreateOAuthUser(ctx context.Context, arg sqlcdb.CreateOAuthUserParams) (sqlcdb.User, error)
	CreateAccount(ctx context.Context, arg sqlcdb.CreateAccountParams) error
	BackfillOAuthAccountEmail(ctx context.Context, arg sqlcdb.BackfillOAuthAccountEmailParams) error
}

// Sessions is the narrow session interface the handlers consume (the middleware
// consumes a broader one — see internal/middleware). Satisfied by *session.Manager.
type Sessions interface {
	Authenticate(ctx context.Context, userID, pwFingerprint string) error
	Destroy(ctx context.Context) error
	Deadline(ctx context.Context) time.Time
}

// Config carries the non-secret auth settings the handlers need.
type Config struct {
	// SPAOrigin is the SPA origin, used to build the redirectTo targets returned by
	// register/forgot-password (parity with the Next routes' redirect JSON).
	SPAOrigin string
	// OutboundEmailEnabled mirrors the Next app's outboundEmailEnabled kill-switch:
	// when false, email verification is bypassed (auto-verify, no unverified gate).
	OutboundEmailEnabled bool
	// FailClosed makes the rate limiter deny on a Redis outage (429) instead of allowing
	// through. Defaults to true for any deploy; only local dev opts out via
	// RATE_LIMIT_FAIL_OPEN so a Redis blip on an internet-facing box can't disable
	// brute-force/spam protection.
	FailClosed bool
	// TrustedProxyDepth is the number of trusted reverse-proxy hops in front of the
	// service, counted from the right of X-Forwarded-For (see clientIP). 0 for Cloud
	// Run's direct domain mapping.
	TrustedProxyDepth int
}

// Deps are the collaborators an auth Service is built from — each behind a narrow,
// consumer-defined interface. It is the exported constructor input (Register/New take
// it) and is embedded verbatim in Service, so there is a single field set rather than a
// duplicated one kept in sync by hand.
type Deps struct {
	Users    UserStore
	Sessions Sessions
	Limiter  ratelimit.Limiter
	Tokens   Tokens
	Email    Emailer
	// Providers holds the configured OAuth providers keyed by name ("github", "google").
	// A provider is present only when its credentials are set, so OAuth start/callback are
	// registered per-provider (an empty map disables OAuth entirely — dev/CI without secrets).
	Providers map[string]OAuthProvider
	IDs       func() string // new-row id generator (UUIDv7 in production)
	Logger    *slog.Logger
	Cfg       Config
}

// Service owns every auth operation's behaviour over its injected collaborators. It
// embeds Deps (no second, hand-copied field set) and methods take a pointer receiver
// (no per-call copy of the collaborator set). Built once via New and shared across all
// operations — the handlers are stateless closures over it.
type Service struct {
	Deps
}

// New builds a Service from its dependencies.
func New(d Deps) *Service {
	return &Service{Deps: d}
}

// tagAuth is the OpenAPI tag grouping all auth operations.
const tagAuth = "auth"

// genericErrorMessage is the opaque body returned on any 500 — it never leaks the
// underlying failure (which is logged instead), so every internal error looks alike.
const genericErrorMessage = "Something went wrong. Please try again."

// Register builds the Service and wires every auth operation onto the API. Flows are
// added here as they land; login/session/logout are the first slice (the Frontend F0
// unblocker).
func Register(api huma.API, d Deps) {
	s := New(d)
	registerLogin(api, s)
	registerSession(api, s)
	registerLogout(api, s)
	registerRegister(api, s)
	registerVerifyEmail(api, s)
	registerResendVerification(api, s)
	registerForgotPassword(api, s)
	registerResetPassword(api, s)
	registerConfirmLoginEmail(api, s)
	registerOAuth(api, s)
}

const (
	minPasswordLength    = 8
	maxNewPasswordLength = 72
)

// validateNewPassword trims the password and validates its length (8 to 72 characters)
// and confirmation match. Returns the trimmed password on success.
func validateNewPassword(password, confirm string) (string, error) {
	trimmed := strings.TrimSpace(password)
	if len(trimmed) < minPasswordLength {
		return "", huma.Error422UnprocessableEntity("Password must be at least 8 characters.")
	}
	if len(trimmed) > maxNewPasswordLength {
		return "", huma.Error422UnprocessableEntity("Password must be at most 72 characters.")
	}
	if trimmed != strings.TrimSpace(confirm) {
		return "", huma.Error422UnprocessableEntity("Passwords do not match.")
	}
	return trimmed, nil
}

// normalizeEmail trims and lowercases, matching the shared EmailSchema so lookups
// are case-insensitive and consistent with rows written by the Next app.
func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

// enforceLimit consumes one token from the named bucket for key and returns a 429
// error when the caller is over budget. On a Redis outage it fails closed (429) unless
// RateLimitFailOpen is set (local dev only), so an internet-facing deploy never silently
// drops brute-force/spam protection during a blip.
func (s *Service) enforceLimit(ctx context.Context, bucket, key string) error {
	dec, err := s.Limiter.Allow(ctx, bucket, key)
	if err != nil {
		if s.Cfg.FailClosed {
			s.Logger.ErrorContext(ctx, "rate limiter unavailable, failing closed", "bucket", bucket, "err", err)
			return rateLimitError(time.Minute)
		}
		s.Logger.WarnContext(ctx, "rate limiter unavailable, failing open", "bucket", bucket, "err", err)
		return nil
	}
	if !dec.Allowed {
		return rateLimitError(dec.RetryAfter)
	}
	return nil
}

// rateLimitError builds the 429 response: an RFC 9457 error whose detail is the
// human message plus a Retry-After header (seconds, minimum 1).
func rateLimitError(retryAfter time.Duration) error {
	secs := max(int(math.Ceil(retryAfter.Seconds())), 1)
	return huma.ErrorWithHeaders(
		huma.Error429TooManyRequests(deniedMessage(retryAfter)),
		http.Header{"Retry-After": {strconv.Itoa(secs)}},
	)
}

// deniedMomentMessage is the sub-minute rate-limit denial message.
const deniedMomentMessage = "Too many attempts. Please try again in a moment."

// deniedMessage mirrors the Next app's deniedMessage: minutes-granular, with a
// friendlier phrasing for sub-minute waits.
func deniedMessage(retryAfter time.Duration) string {
	mins := int(math.Ceil(retryAfter.Minutes()))
	if mins <= 1 {
		return deniedMomentMessage
	}
	return "Too many attempts. Please try again in " + strconv.Itoa(mins) + " minutes."
}
