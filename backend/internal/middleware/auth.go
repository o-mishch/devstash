// Package middleware holds the Huma-native request middleware. auth.go enforces
// session-based authentication for operations that opt in via Operation.Security,
// and resolves the current user (password-rotation, deleted-user, and idle checks)
// once per request so handlers read it from the context.
package middleware

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"slices"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/jackc/pgx/v5"

	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
	"github.com/o-mishch/devstash/backend/internal/postgres"
	"github.com/o-mishch/devstash/backend/internal/session"
)

// SessionScheme is the OpenAPI security-scheme name that marks an operation as
// requiring a valid session. Operations opt in with
// Security: []map[string][]string{{middleware.SessionScheme: {}}}.
const SessionScheme = "session"

type ctxKey int

const (
	userKey ctxKey = iota
	userIDKey
	remoteAddrKey
)

// SessionResolver is the session behavior the middleware needs. Satisfied by
// *session.Manager; faked in tests.
type SessionResolver interface {
	UserID(ctx context.Context) string
	Fingerprint(ctx context.Context) string
	UpdateFingerprint(ctx context.Context, pwFingerprint string)
	LastActiveAt(ctx context.Context) time.Time
	Touch(ctx context.Context)
	Destroy(ctx context.Context) error
}

// UserByIDStore is the narrow data dependency: resolve the session's user.
type UserByIDStore interface {
	GetUserByID(ctx context.Context, id string) (sqlcdb.User, error)
}

// RequireSession returns a Huma middleware that enforces SessionScheme. For a
// non-secured operation it passes through. For a secured one it resolves the
// session user and applies the envelope checks (deleted user, password rotation,
// idle refresh), rejecting with 401 when the session is absent or invalid. The
// resolved userID (always) and user (when the DB was reachable) are stashed for
// downstream handlers.
func RequireSession(
	api huma.API,
	sess SessionResolver,
	users UserByIDStore,
	logger *slog.Logger,
) func(huma.Context, func(huma.Context)) {
	return func(ctx huma.Context, next func(huma.Context)) {
		if !requiresSession(ctx.Operation()) {
			next(ctx)
			return
		}

		gctx := ctx.Context()
		userID := sess.UserID(gctx)
		if userID == "" {
			unauthorized(api, ctx)
			return
		}

		user, admit, ok := resolveSessionUser(gctx, sess, users, userID, logger)
		if !ok {
			unauthorized(api, ctx)
			return
		}
		if !admit {
			// Transient DB blip: preserve the session, pass through with only the
			// userID stashed so handlers needing the full user re-resolve and degrade.
			// Still refresh the idle deadline (throttled) as the TS session callback did
			// before its DB fetch — otherwise a DB outage longer than the idle window
			// would silently expire an actively-used session mid-outage.
			if session.ShouldPersistActivity(sess.LastActiveAt(gctx), time.Now()) {
				sess.Touch(gctx)
			}
			next(huma.WithValue(ctx, userIDKey, userID))
			return
		}
		if !applyEnvelopeChecks(gctx, sess, user, logger) {
			unauthorized(api, ctx)
			return
		}

		ctx = huma.WithValue(ctx, userIDKey, userID)
		ctx = huma.WithValue(ctx, userKey, user)
		next(ctx)
	}
}

// resolveSessionUser loads the session's user. It returns (user, admit, ok):
//   - ok=false                → reject the request (deleted user or hard DB error)
//   - ok=true, admit=false    → transient DB blip; preserve the session but no user
//   - ok=true, admit=true     → user resolved
func resolveSessionUser(
	ctx context.Context,
	sess SessionResolver,
	users UserByIDStore,
	userID string,
	logger *slog.Logger,
) (sqlcdb.User, bool, bool) {
	user, err := users.GetUserByID(ctx, userID)
	if err == nil {
		return user, true, true
	}
	if postgres.IsTransient(err) {
		logger.WarnContext(ctx, "auth: transient DB error, preserving session", "err", err)
		return sqlcdb.User{}, false, true
	}
	// A deleted user (no row) invalidates the session; other errors just reject.
	if errors.Is(err, pgx.ErrNoRows) {
		if derr := sess.Destroy(ctx); derr != nil {
			logger.ErrorContext(ctx, "auth: destroy after deleted user failed", "err", derr)
		}
	} else {
		logger.ErrorContext(ctx, "auth: session user lookup failed", "err", err)
	}
	return sqlcdb.User{}, false, false
}

// applyEnvelopeChecks runs the password-rotation and idle-refresh checks. It
// returns false when the session must be rejected (the password rotated).
func applyEnvelopeChecks(ctx context.Context, sess SessionResolver, user sqlcdb.User, logger *slog.Logger) bool {
	// A changed hash (had a password -> different hash) kills the session; an
	// added/removed password syncs the fingerprint but keeps it alive.
	current := session.PasswordFingerprint(deref(user.Password))
	switch session.ClassifyFingerprint(sess.Fingerprint(ctx), current) {
	case session.FingerprintInvalidate:
		if derr := sess.Destroy(ctx); derr != nil {
			logger.ErrorContext(ctx, "auth: destroy after password rotation failed", "err", derr)
		}
		return false
	case session.FingerprintSync:
		sess.UpdateFingerprint(ctx, current)
	case session.FingerprintUnchanged:
	}

	// Refresh the idle deadline on activity, throttled to UpdateAge.
	if session.ShouldPersistActivity(sess.LastActiveAt(ctx), time.Now()) {
		sess.Touch(ctx)
	}
	return true
}

// CurrentUserID returns the authenticated user's id from a secured request's
// context. Present whenever RequireSession admitted the request.
func CurrentUserID(ctx context.Context) (string, bool) {
	id, ok := ctx.Value(userIDKey).(string)
	return id, ok && id != ""
}

// CurrentUser returns the resolved session user. Absent only when the request was
// admitted during a transient DB outage (the userID is still available).
func CurrentUser(ctx context.Context) (sqlcdb.User, bool) {
	u, ok := ctx.Value(userKey).(sqlcdb.User)
	return u, ok
}

// requiresSession reports whether the operation declares the session security scheme.
func requiresSession(op *huma.Operation) bool {
	return slices.ContainsFunc(op.Security, func(scheme map[string][]string) bool {
		_, ok := scheme[SessionScheme]
		return ok
	})
}

func unauthorized(api huma.API, ctx huma.Context) {
	_ = huma.WriteErr(api, ctx, http.StatusUnauthorized, "Unauthorized")
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
