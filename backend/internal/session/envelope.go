package session

import "time"

// Session-envelope timing, ported 1:1 from the NextAuth session (src/auth.ts):
//   - MaxAge      absolute lifetime (SESSION_MAX_AGE = 24h)
//   - IdleTimeout inactivity cutoff (SESSION_IDLE_TIMEOUT_SEC = 30m)
//   - UpdateAge   how often lastActiveAt is re-persisted (SESSION_UPDATE_AGE = 60s),
//     so an active session doesn't rewrite its store row every request.
const (
	MaxAge      = 24 * time.Hour
	IdleTimeout = 30 * time.Minute
	UpdateAge   = 60 * time.Second
)

// PasswordFingerprint is the last 8 characters of a bcrypt hash, or "" when the
// user has no password. It binds a session to the password that created it: the
// auth middleware compares the session's stored fingerprint against the user's
// current hash to detect a rotation. Parity: `dbUser.password?.slice(-8) ?? ”`.
func PasswordFingerprint(hash string) string {
	if len(hash) <= fingerprintLen {
		return hash
	}
	return hash[len(hash)-fingerprintLen:]
}

// fingerprintLen is how many trailing hash characters form the fingerprint.
const fingerprintLen = 8

// FingerprintChange classifies a password-fingerprint transition between the value
// stored in the session and the user's current hash. Parity: classifyPasswordFingerprint.
type FingerprintChange int

const (
	// FingerprintUnchanged means the fingerprint is identical — nothing to do.
	FingerprintUnchanged FingerprintChange = iota
	// FingerprintInvalidate means the user had a password and still has one but it
	// rotated — kill the session (forced re-login on every device).
	FingerprintInvalidate
	// FingerprintSync means a password was added ("" -> hash) or removed (hash -> "")
	// — update the stored fingerprint but keep the session alive (e.g. an OAuth-only
	// user who just added Email & Password sign-in).
	FingerprintSync
)

// ClassifyFingerprint compares the session's stored fingerprint (prev) with the
// user's current one (next).
func ClassifyFingerprint(prev, next string) FingerprintChange {
	if prev == next {
		return FingerprintUnchanged
	}
	hadPassword := prev != ""
	hasPassword := next != ""
	if hadPassword && hasPassword {
		return FingerprintInvalidate
	}
	return FingerprintSync
}

// ShouldPersistActivity reports whether lastActiveAt should be re-persisted now.
// scs enforces the hard idle expiry (IdleTimeout on the store TTL); the auth
// middleware calls this to decide whether to touch the session so scs refreshes
// that TTL on activity — throttled to UpdateAge so an active session doesn't
// rewrite its store row on every request.
func ShouldPersistActivity(lastActive, now time.Time) bool {
	return lastActive.IsZero() || now.Sub(lastActive) >= UpdateAge
}
