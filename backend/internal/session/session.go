// Package session wires the opaque, stateful session used by every authenticated
// request. It composes alexedwards/scs (session lifecycle) with a Redis-backed
// goredisstore, and owns the session "envelope": the small set of claims each
// session carries (userID, a password fingerprint for rotation invalidation, and a
// last-active timestamp for idle-timeout parity with the old NextAuth session).
//
// Redis (not Postgres) backs the store: session load is on the hot path of every
// authenticated request, and Neon is a connection-limited, scale-to-zero pooled
// endpoint — keeping session reads off it avoids latency and pool pressure. Redis
// is already in the auth path (rate-limit, one-time tokens), gives native TTL
// expiry (no cleanup goroutine) and instant DEL revocation, and goredisstore uses
// the same go-redis client the rest of Phase 1 uses.
//
// Transport is a single httpOnly cookie today. scs.LoadAndSave handles cookie
// read/write and end-of-request commit; a future Bearer transport for mobile is a
// custom middleware built on the same manager (scs supports header/body tokens),
// so nothing here is cookie-specific beyond the Cookie config below.
package session

import (
	"context"
	"net/http"
	"time"

	"github.com/alexedwards/scs/goredisstore"
	"github.com/alexedwards/scs/v2"
	"github.com/redis/go-redis/v9"
)

// Claim keys stored inside the scs gob blob. Centralised here so middleware and
// handlers reference one source of truth for the session envelope's shape.
const (
	keyUserID        = "userID"
	keyPwFingerprint = "pwFingerprint"
	keyLastActiveAt  = "lastActiveAt"
)

// Config is the transport/lifetime configuration for the session cookie. Built by
// the caller from the app config (production sets Secure and, by default, leaves
// CookieDomain empty for a host-only cookie scoped to the API host alone).
type Config struct {
	// Lifetime is the absolute session max age (NextAuth SESSION_MAX_AGE = 24h).
	Lifetime time.Duration
	// IdleTimeout expires a session after inactivity. Zero disables it.
	IdleTimeout time.Duration
	// CookieDomain scopes the cookie. Empty (the default, from COOKIE_DOMAIN) yields a
	// host-only cookie bound to the API host; set a parent domain only to share the
	// cookie across distinct subdomains. See config.Config.CookieDomain.
	CookieDomain string
	// Secure marks the cookie Secure (true in prod HTTPS; false for local http).
	Secure bool
}

// CookieName is the session cookie name. Distinct from the abandoned NextAuth
// "next-auth.session-token" so a stale legacy cookie can never be confused for a
// scs token.
const CookieName = "devstash_session"

// Manager owns the scs session manager and exposes typed accessors for the session
// envelope. Handlers and middleware use these instead of touching scs string keys.
type Manager struct {
	scs *scs.SessionManager
}

// New builds a Manager backed by goredisstore on the shared go-redis client. Redis
// expires session keys natively at TTL, so there is no cleanup goroutine to manage.
// Keys are namespaced "scs:session:<token>" by goredisstore's default prefix.
func New(client *redis.Client, cfg Config) *Manager {
	// Every claim we store is a gob built-in (string, int64), so no gob.Register is
	// needed. lastActiveAt is a Unix int64 rather than a time.Time precisely to keep it
	// that way — storing time.Time would force a gob.Register(time.Time{}) dance.
	sm := scs.New()
	sm.Store = goredisstore.New(client)
	sm.Lifetime = cfg.Lifetime
	sm.IdleTimeout = cfg.IdleTimeout

	sm.Cookie.Name = CookieName
	sm.Cookie.Domain = cfg.CookieDomain
	sm.Cookie.HttpOnly = true
	sm.Cookie.Path = "/"
	sm.Cookie.Persist = true
	sm.Cookie.SameSite = http.SameSiteLaxMode
	sm.Cookie.Secure = cfg.Secure

	return &Manager{scs: sm}
}

// LoadAndSave is the net/http middleware that reads the session cookie, loads the
// session into the request context, and commits + writes the cookie at the end of
// the request. It wraps the whole router so scs data is available to every Huma
// operation via the request context.
func (m *Manager) LoadAndSave(next http.Handler) http.Handler {
	return m.scs.LoadAndSave(next)
}

// Authenticate establishes an authenticated session for userID. It renews the
// session token first (session-fixation defense on privilege change), then records
// the identity claims. pwFingerprint binds the session to the user's current
// password hash so a password change invalidates it (see Fingerprint).
func (m *Manager) Authenticate(ctx context.Context, userID, pwFingerprint string) error {
	if err := m.scs.RenewToken(ctx); err != nil {
		return err
	}
	m.scs.Put(ctx, keyUserID, userID)
	m.scs.Put(ctx, keyPwFingerprint, pwFingerprint)
	m.scs.Put(ctx, keyLastActiveAt, time.Now().Unix())
	return nil
}

// Destroy revokes the current session (logout): deletes the store row and expires
// the cookie. Renewing on next login prevents fixation.
func (m *Manager) Destroy(ctx context.Context) error {
	return m.scs.Destroy(ctx)
}

// UserID returns the authenticated user's id, or "" if the session is anonymous.
func (m *Manager) UserID(ctx context.Context) string {
	return m.scs.GetString(ctx, keyUserID)
}

// Fingerprint returns the password fingerprint recorded when the session was
// established. The auth middleware compares it against the user's current password
// hash; a mismatch means the password rotated and the session must be rejected.
func (m *Manager) Fingerprint(ctx context.Context) string {
	return m.scs.GetString(ctx, keyPwFingerprint)
}

// UpdateFingerprint records a new password fingerprint without renewing the token.
// Used by the middleware when a password was added or removed (a "sync" change) to
// keep the session alive while tracking the new hash.
func (m *Manager) UpdateFingerprint(ctx context.Context, pwFingerprint string) {
	m.scs.Put(ctx, keyPwFingerprint, pwFingerprint)
}

// Deadline returns the session's absolute expiry, used to stamp the `expires` field
// of GET /auth/session.
func (m *Manager) Deadline(ctx context.Context) time.Time {
	return m.scs.Deadline(ctx)
}

// LastActiveAt returns the last recorded activity time, zero if unset. Stored as a
// Unix int64 (see New) and reconstituted here.
func (m *Manager) LastActiveAt(ctx context.Context) time.Time {
	if sec, ok := m.scs.Get(ctx, keyLastActiveAt).(int64); ok {
		return time.Unix(sec, 0)
	}
	return time.Time{}
}

// Touch records activity now. Callers throttle how often they call this (the
// NextAuth SESSION_UPDATE_AGE granularity) so every request doesn't rewrite the row.
func (m *Manager) Touch(ctx context.Context) {
	m.scs.Put(ctx, keyLastActiveAt, time.Now().Unix())
}
