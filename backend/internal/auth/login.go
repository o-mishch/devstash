package auth

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"github.com/o-mishch/devstash/backend/internal/middleware"
	"github.com/o-mishch/devstash/backend/internal/ratelimit"
	"github.com/o-mishch/devstash/backend/internal/session"
)

// noContent is the empty body for 204 responses (login, logout).
type noContent struct{}

// loginInput is the credential login request. Huma validates format/length and
// returns 422 before the handler runs.
type loginInput struct {
	Body struct {
		Email    string `doc:"Account email"    format:"email"  json:"email"    required:"true"`
		Password string `doc:"Account password" json:"password" maxLength:"128" minLength:"1"   required:"true"`
	}
}

// registerLogin wires POST /auth/login. Success is 204 with the session cookie set
// by the LoadAndSave middleware. Parity order: IP guard -> validate -> per-account
// budget -> verified gate -> authorize-IP guard -> establish session.
func registerLogin(api huma.API, s *Service) {
	huma.Register(api, huma.Operation{
		OperationID:   "auth-login",
		Method:        http.MethodPost,
		Path:          "/auth/login",
		Summary:       "Log in with email and password",
		Tags:          []string{tagAuth},
		DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, in *loginInput) (*noContent, error) {
		ip := middleware.RemoteIP(ctx)
		email := normalizeEmail(in.Body.Email)
		// Trim to match the write paths (register/reset/confirm all TrimSpace before
		// hashing), so a password stored as hash(trimmed) still authenticates and the
		// existing Next-written hashes (registered via z.string().trim()) stay valid.
		password := strings.TrimSpace(in.Body.Password)

		if err := s.enforceLimit(ctx, ratelimit.BucketLoginIP, ip); err != nil {
			return nil, err
		}

		match, ok, err := s.validateCredential(ctx, email, password)
		if err != nil {
			s.Logger.ErrorContext(ctx, "login: credential lookup failed", "err", err)
			return nil, huma.Error500InternalServerError(genericErrorMessage)
		}
		if !ok {
			// Spend the per-IP+email budget; exhaustion is a 429, otherwise a generic
			// 400 that doesn't reveal whether the account exists.
			if lerr := s.enforceLimit(ctx, ratelimit.BucketLogin, ip+":"+email); lerr != nil {
				return nil, lerr
			}
			return nil, huma.Error400BadRequest("Invalid email or password.")
		}

		// The email must be verified before a correct password logs in (the SPA
		// already holds the typed email to drive its resend flow, so the 403 detail
		// carries the message only).
		if s.Cfg.OutboundEmailEnabled && !match.matchedVerified {
			return nil, huma.Error403Forbidden("Please verify your email before signing in.")
		}

		// The authorize path spends its own IP budget in the Next app; preserve that
		// accounting so the two guards stay independent.
		if err := s.enforceLimit(ctx, ratelimit.BucketLoginAuthorizeIP, ip); err != nil {
			return nil, err
		}

		fingerprint := session.PasswordFingerprint(*match.user.Password)
		if err := s.Sessions.Authenticate(ctx, match.user.ID, fingerprint); err != nil {
			s.Logger.ErrorContext(ctx, "login: establish session failed", "err", err)
			return nil, huma.Error500InternalServerError(genericErrorMessage)
		}
		s.Logger.InfoContext(ctx, "login succeeded", "userID", match.user.ID)
		return &noContent{}, nil
	})
}

// sessionRetryAfterSeconds is the Retry-After hint on the degraded GET /auth/session
// response during a transient DB outage — short, since the blip is expected to clear.
const sessionRetryAfterSeconds = "5"

// sessionUser is the public shape of the authenticated user (no password, no
// Stripe internals) returned by GET /auth/session.
type sessionUser struct {
	ID    string  `json:"id"`
	Email string  `json:"email"`
	Name  *string `json:"name"`
	Image *string `json:"image"`
	IsPro bool    `json:"isPro"`
}

type sessionOutput struct {
	Body struct {
		User    sessionUser `json:"user"`
		Expires time.Time   `json:"expires"`
	}
}

// registerSession wires GET /auth/session — the SPA's client-side auth check. The
// middleware has already resolved and stashed the user (or 401'd); this handler
// shapes the response. On the transient-DB path the user is re-resolved by id.
func registerSession(api huma.API, s *Service) {
	huma.Register(api, huma.Operation{
		OperationID: "auth-session",
		Method:      http.MethodGet,
		Path:        "/auth/session",
		Summary:     "Get the current session user",
		Tags:        []string{tagAuth},
		Security:    []map[string][]string{{middleware.SessionScheme: {}}},
	}, func(ctx context.Context, _ *struct{}) (*sessionOutput, error) {
		user, ok := middleware.CurrentUser(ctx)
		if !ok {
			id, _ := middleware.CurrentUserID(ctx)
			resolved, err := s.Users.GetUserByID(ctx, id)
			if err != nil {
				s.Logger.ErrorContext(ctx, "session: user re-resolve failed", "err", err)
				// The middleware deliberately preserved the session across a transient DB
				// blip; signal "retry shortly" (503 + Retry-After), not 401, so the SPA
				// treats a momentary outage as transient rather than a forced logout.
				return nil, huma.ErrorWithHeaders(
					huma.Error503ServiceUnavailable("The service is temporarily unavailable."),
					http.Header{"Retry-After": {sessionRetryAfterSeconds}},
				)
			}
			user = resolved
		}

		out := &sessionOutput{}
		out.Body.User = sessionUser{
			ID:    user.ID,
			Email: user.Email,
			Name:  user.Name,
			Image: user.Image,
			IsPro: user.IsPro,
		}
		out.Body.Expires = s.Sessions.Deadline(ctx)
		return out, nil
	})
}

// registerLogout wires POST /auth/logout — revoke the current session (Redis DEL +
// expired cookie via scs.Destroy). Idempotent from the client's view: a secured
// request always has a session to destroy.
func registerLogout(api huma.API, s *Service) {
	huma.Register(api, huma.Operation{
		OperationID:   "auth-logout",
		Method:        http.MethodPost,
		Path:          "/auth/logout",
		Summary:       "Log out of the current session",
		Tags:          []string{tagAuth},
		Security:      []map[string][]string{{middleware.SessionScheme: {}}},
		DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, _ *struct{}) (*noContent, error) {
		userID, _ := middleware.CurrentUserID(ctx)
		if err := s.Sessions.Destroy(ctx); err != nil {
			s.Logger.ErrorContext(ctx, "logout: destroy session failed", "err", err)
			return nil, huma.Error500InternalServerError(genericErrorMessage)
		}
		s.Logger.InfoContext(ctx, "logout succeeded", "userID", userID)
		return &noContent{}, nil
	})
}
