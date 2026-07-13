package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// One-time token namespaces and TTLs, ported from the Next app (src/lib/auth/tokens.ts).
// The raw token lives only in the emailed URL; Redis stores it hashed as the key.
const (
	nsVerifyEmail     = "auth:verify-email"
	nsVerifySent      = "auth:verify-sent"
	nsPasswordReset   = "auth:password-reset"
	nsCredentialEmail = "auth:credential-email"     // #nosec G101
	nsCredentialGen   = "auth:credential-email-gen" // #nosec G101
	nsOAuthState      = "auth:oauth-state"
	nsPendingLink     = "auth:pending-link" // #nosec G101

	ttlVerifyEmail     = 24 * time.Hour
	ttlVerifySent      = 55 * time.Minute
	ttlPasswordReset   = time.Hour
	ttlCredentialEmail = time.Hour
	// ttlOAuthState bounds the round-trip to the provider and back; short so a leaked
	// state param has a small replay window (it is single-use besides — see ConsumeOAuthState).
	ttlOAuthState = 10 * time.Minute
	// ttlPendingLink matches the Next app's 15-minute pending-link window: the time a user
	// has to enter their password on /link-account after an OAuth conflict is detected.
	ttlPendingLink = 15 * time.Minute

	tokenBytes = 32 // 256-bit raw token, hex-encoded to 64 chars
)

// PendingLink is the value stored for a pending account-link token (parity:
// PendingLinkData). It carries everything needed to write the accounts row once the
// user proves ownership of Email with their password on /link-account. Email is the
// DevStash user's primary email (the confirm step re-resolves the user from it and
// checks the password); ProviderEmail is the OAuth identity's email, stored on
// accounts.email. The raw provider tokens are persisted verbatim so the linked row
// matches what a first-party OAuth sign-up would have written.
type PendingLink struct {
	Email             string  `json:"email"`
	ProviderEmail     *string `json:"providerEmail"`
	Provider          string  `json:"provider"`
	ProviderAccountID string  `json:"providerAccountId"`
	Type              string  `json:"type"`
	AccessToken       *string `json:"accessToken"`
	RefreshToken      *string `json:"refreshToken"`
	ExpiresAt         *int32  `json:"expiresAt"`
	TokenType         *string `json:"tokenType"`
	Scope             *string `json:"scope"`
	IDToken           *string `json:"idToken"`
	SessionState      *string `json:"sessionState"`
}

// CredentialEmailPayload is the value stored for a credential-email token. gen ties
// the token to the latest-issued link so an older link (lower gen) can't be consumed.
// The add-vs-change decision is derived from live account state at confirm time
// (user.Password != nil), not carried in the payload, so no mode field is stored.
type CredentialEmailPayload struct {
	UserID string `json:"userId"`
	Email  string `json:"email"`
	Gen    int64  `json:"gen"`
}

// Tokens is the one-time-token behavior the auth handlers consume.
//
// Every consumable link (verification, reset, credential-email) follows a peek-then-consume
// protocol: Peek validates a token non-destructively, and Consume burns it only once the
// flow reaches a terminal outcome (success, a permanent rejection, or a deleted account). A
// transient failure mid-flow therefore leaves the emailed link armed for a retry with no
// compensating "restore" step. Consume is atomic per token (a plain delete for
// verify/reset; a gen-checked delete for credential-email), so a concurrent
// double-redemption deletes the key exactly once — but it does NOT serialize the
// surrounding DB write, so two racing callers can each apply the (idempotent) write before
// the single delete lands.
type Tokens interface {
	CreateVerification(ctx context.Context, email string) (string, error)
	PeekVerification(ctx context.Context, raw string) (string, bool, error)
	ConsumeVerification(ctx context.Context, raw string) error
	VerificationRecentlySent(ctx context.Context, email string) (bool, error)
	SetVerificationSent(ctx context.Context, email string) error
	CreatePasswordReset(ctx context.Context, email string) (string, error)
	PeekPasswordReset(ctx context.Context, raw string) (string, bool, error)
	ConsumePasswordReset(ctx context.Context, raw string) error
	CreateCredentialEmail(ctx context.Context, userID, email string) (string, error)
	PeekCredentialEmail(ctx context.Context, raw string) (CredentialEmailPayload, bool, error)
	ConsumeCredentialEmail(ctx context.Context, raw string, payload CredentialEmailPayload) (bool, error)
	// OAuth CSRF state: single-use (ConsumeOAuthState is an atomic GETDEL), so a state
	// param can be redeemed exactly once even if replayed.
	CreateOAuthState(ctx context.Context, provider string) (string, error)
	ConsumeOAuthState(ctx context.Context, raw string) (string, bool, error)
	// Account-link handoff (peek-then-consume, like the other links): the callback
	// mints it on a detected conflict; /auth/link peeks it to resolve the target, then
	// consumes it only after the account is linked, so a wrong password leaves it armed.
	CreatePendingLink(ctx context.Context, link PendingLink) (string, error)
	PeekPendingLink(ctx context.Context, raw string) (PendingLink, bool, error)
	ConsumePendingLink(ctx context.Context, raw string) error
}

// consumeCredentialEmailSrc atomically consumes a credential-email token only if its
// stored gen still matches the current generation — otherwise a superseded link
// (lower gen) could be redeemed. KEYS[1]=gen key, KEYS[2]=token key, ARGV[1]=gen.
const consumeCredentialEmailSrc = `
local current = redis.call('GET', KEYS[1])
if not current or tonumber(current) ~= tonumber(ARGV[1]) then
  return nil
end
return redis.call('GETDEL', KEYS[2])
`

// RedisTokens is the production Tokens store over go-redis.
type RedisTokens struct {
	rdb              *redis.Client
	consumeCredEmail *redis.Script
}

// NewTokens builds a RedisTokens on the shared client.
func NewTokens(rdb *redis.Client) *RedisTokens {
	return &RedisTokens{rdb: rdb, consumeCredEmail: redis.NewScript(consumeCredentialEmailSrc)}
}

// key hashes the raw token into its namespaced storage key (raw never stored).
func key(ns, raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return ns + ":" + hex.EncodeToString(sum[:])
}

// newRawToken returns a 256-bit cryptographically-random hex token.
func newRawToken() (string, error) {
	b := make([]byte, tokenBytes)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("tokens: read random: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// CreateVerification mints a verification token.
func (s *RedisTokens) CreateVerification(ctx context.Context, email string) (string, error) {
	raw, err := newRawToken()
	if err != nil {
		return "", err
	}
	if err = s.rdb.Set(ctx, key(nsVerifyEmail, raw), email, ttlVerifyEmail).Err(); err != nil {
		return "", fmt.Errorf("tokens: store verification: %w", err)
	}
	return raw, nil
}

// SetVerificationSent sets the anti-spam verify-sent marker.
func (s *RedisTokens) SetVerificationSent(ctx context.Context, email string) error {
	if err := s.rdb.Set(ctx, nsVerifySent+":"+email, "1", ttlVerifySent).Err(); err != nil {
		return fmt.Errorf("tokens: store verify-sent marker: %w", err)
	}
	return nil
}

// PeekVerification reads a verification token's email without consuming it. A
// missing/expired token maps to ok=false. The token is burned separately via
// ConsumeVerification once the email is marked verified, so a transient mark-write
// failure leaves the emailed link usable for a retry (no compensating restore).
func (s *RedisTokens) PeekVerification(ctx context.Context, raw string) (string, bool, error) {
	v, err := s.rdb.Get(ctx, key(nsVerifyEmail, raw)).Result()
	if errors.Is(err, redis.Nil) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("tokens: peek verification: %w", err)
	}
	return v, true, nil
}

// ConsumeVerification burns a verification token (single-use). Idempotent: deleting an
// already-consumed or expired key is not an error.
func (s *RedisTokens) ConsumeVerification(ctx context.Context, raw string) error {
	if err := s.rdb.Del(ctx, key(nsVerifyEmail, raw)).Err(); err != nil {
		return fmt.Errorf("tokens: consume verification: %w", err)
	}
	return nil
}

// VerificationRecentlySent reports whether a verification email was sent within the window.
func (s *RedisTokens) VerificationRecentlySent(ctx context.Context, email string) (bool, error) {
	n, err := s.rdb.Exists(ctx, nsVerifySent+":"+email).Result()
	if err != nil {
		return false, fmt.Errorf("tokens: check verify-sent: %w", err)
	}
	return n > 0, nil
}

// CreatePasswordReset mints a password-reset token.
func (s *RedisTokens) CreatePasswordReset(ctx context.Context, email string) (string, error) {
	raw, err := newRawToken()
	if err != nil {
		return "", err
	}
	if err = s.rdb.Set(ctx, key(nsPasswordReset, raw), email, ttlPasswordReset).Err(); err != nil {
		return "", fmt.Errorf("tokens: store password reset: %w", err)
	}
	return raw, nil
}

// PeekPasswordReset reads a reset token's email without consuming it. A missing/expired
// token maps to ok=false (the "invalid or expired" outcome), not an error. The token is
// burned separately via ConsumePasswordReset once the reset reaches a terminal outcome.
func (s *RedisTokens) PeekPasswordReset(ctx context.Context, raw string) (string, bool, error) {
	v, err := s.rdb.Get(ctx, key(nsPasswordReset, raw)).Result()
	if errors.Is(err, redis.Nil) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("tokens: peek password reset: %w", err)
	}
	return v, true, nil
}

// ConsumePasswordReset burns a reset token (single-use). Idempotent: deleting an
// already-consumed or expired key is not an error. Note the delete is atomic but does
// NOT serialize the peek+write that precedes it — two racing callers can both Peek and
// both apply the (idempotent) password write before either delete lands; the reset is
// authorized by the token holder either way, so a double-click is benign, not a bypass.
func (s *RedisTokens) ConsumePasswordReset(ctx context.Context, raw string) error {
	if err := s.rdb.Del(ctx, key(nsPasswordReset, raw)).Err(); err != nil {
		return fmt.Errorf("tokens: consume password reset: %w", err)
	}
	return nil
}

// CreateCredentialEmail mints a gen-tagged credential-email token, superseding any prior link for the user.
func (s *RedisTokens) CreateCredentialEmail(
	ctx context.Context,
	userID, email string,
) (string, error) {
	raw, err := newRawToken()
	if err != nil {
		return "", err
	}
	genKey := nsCredentialGen + ":" + userID
	gen, err := s.rdb.Incr(ctx, genKey).Result()
	if err != nil {
		return "", fmt.Errorf("tokens: bump credential-email gen: %w", err)
	}
	if err = s.rdb.Expire(ctx, genKey, ttlCredentialEmail).Err(); err != nil {
		return "", fmt.Errorf("tokens: expire credential-email gen: %w", err)
	}
	payload := CredentialEmailPayload{UserID: userID, Email: email, Gen: gen}
	blob, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("tokens: marshal credential-email: %w", err)
	}
	if err = s.rdb.Set(ctx, key(nsCredentialEmail, raw), blob, ttlCredentialEmail).Err(); err != nil {
		// Deliberately no Decr rollback: only monotonicity matters (a skipped gen never
		// makes an older token redeemable). A concurrent request may already have taken
		// the next gen, so decrementing here would strand its still-valid token — its
		// gen-check would then read a lower current gen and reject it.
		return "", fmt.Errorf("tokens: store credential-email: %w", err)
	}
	return raw, nil
}

// PeekCredentialEmail reads and validates a credential-email token without consuming it:
// it loads the payload and confirms the stored gen is still current. A missing token, a
// missing gen key (expired), or a superseded gen (a newer link was minted) all map to
// ok=false. The token is burned separately via ConsumeCredentialEmail once the update
// reaches a terminal outcome.
func (s *RedisTokens) PeekCredentialEmail(ctx context.Context, raw string) (CredentialEmailPayload, bool, error) {
	blob, err := s.rdb.Get(ctx, key(nsCredentialEmail, raw)).Result()
	if errors.Is(err, redis.Nil) {
		return CredentialEmailPayload{}, false, nil
	}
	if err != nil {
		return CredentialEmailPayload{}, false, fmt.Errorf("tokens: get credential-email: %w", err)
	}
	var payload CredentialEmailPayload
	if err = json.Unmarshal([]byte(blob), &payload); err != nil {
		return CredentialEmailPayload{}, false, fmt.Errorf("tokens: unmarshal credential-email: %w", err)
	}
	cur, err := s.rdb.Get(ctx, nsCredentialGen+":"+payload.UserID).Int64()
	if errors.Is(err, redis.Nil) {
		return CredentialEmailPayload{}, false, nil // gen key gone (expired) → invalid
	}
	if err != nil {
		return CredentialEmailPayload{}, false, fmt.Errorf("tokens: get credential-email gen: %w", err)
	}
	if cur != payload.Gen {
		return CredentialEmailPayload{}, false, nil // superseded by a newer link
	}
	return payload, true, nil
}

// ConsumeCredentialEmail atomically burns the token iff its gen is still current, so
// exactly one caller wins even under a concurrent redemption. consumed=false means the
// token was already taken or superseded between Peek and here — a benign race, since the
// caller's DB write is idempotent either way.
func (s *RedisTokens) ConsumeCredentialEmail(
	ctx context.Context,
	raw string,
	payload CredentialEmailPayload,
) (bool, error) {
	genKey := nsCredentialGen + ":" + payload.UserID
	res, err := s.consumeCredEmail.Run(ctx, s.rdb, []string{genKey, key(nsCredentialEmail, raw)}, payload.Gen).Result()
	// The script returns nil (redis.Nil) when the gen no longer matches or the token was
	// already taken — not consumed, but not an error. A real transport error must be
	// checked before the nil result, since a failed Run also yields a nil res.
	if errors.Is(err, redis.Nil) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("tokens: consume credential-email: %w", err)
	}
	return res != nil, nil
}

// CreateOAuthState mints a single-use OAuth state token bound to provider. The raw
// token travels in the authorize-URL `state` param and is echoed back by the
// provider on the callback; the stored provider guards against a state minted for one
// provider being replayed on another's callback.
func (s *RedisTokens) CreateOAuthState(ctx context.Context, provider string) (string, error) {
	raw, err := newRawToken()
	if err != nil {
		return "", err
	}
	if err = s.rdb.Set(ctx, key(nsOAuthState, raw), provider, ttlOAuthState).Err(); err != nil {
		return "", fmt.Errorf("tokens: store oauth state: %w", err)
	}
	return raw, nil
}

// ConsumeOAuthState atomically reads and deletes an OAuth state token (GETDEL), so a
// valid state is accepted exactly once. A missing/expired token maps to ok=false (the
// "invalid state" outcome), not an error; a present one returns the bound provider.
func (s *RedisTokens) ConsumeOAuthState(ctx context.Context, raw string) (string, bool, error) {
	provider, err := s.rdb.GetDel(ctx, key(nsOAuthState, raw)).Result()
	if errors.Is(err, redis.Nil) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("tokens: consume oauth state: %w", err)
	}
	return provider, true, nil
}

// CreatePendingLink mints a pending-link token carrying the JSON-encoded link.
func (s *RedisTokens) CreatePendingLink(ctx context.Context, link PendingLink) (string, error) {
	raw, err := newRawToken()
	if err != nil {
		return "", err
	}
	// The payload deliberately carries the provider's OAuth tokens (access/refresh/id) so
	// the eventual accounts row matches a first-party link; it lives only in short-TTL
	// Redis, keyed by the SHA-256 of an unguessable raw token, never returned to a client.
	blob, err := json.Marshal(link) // #nosec G117 -- provider tokens are stored intentionally, hashed-key Redis only
	if err != nil {
		return "", fmt.Errorf("tokens: marshal pending link: %w", err)
	}
	if err = s.rdb.Set(ctx, key(nsPendingLink, raw), blob, ttlPendingLink).Err(); err != nil {
		return "", fmt.Errorf("tokens: store pending link: %w", err)
	}
	return raw, nil
}

// PeekPendingLink reads a pending-link token's payload without consuming it. A
// missing/expired token maps to ok=false. The token is burned separately via
// ConsumePendingLink once the account is linked, so a wrong-password attempt leaves
// the link usable for a retry (no compensating restore).
func (s *RedisTokens) PeekPendingLink(ctx context.Context, raw string) (PendingLink, bool, error) {
	blob, err := s.rdb.Get(ctx, key(nsPendingLink, raw)).Result()
	if errors.Is(err, redis.Nil) {
		return PendingLink{}, false, nil
	}
	if err != nil {
		return PendingLink{}, false, fmt.Errorf("tokens: get pending link: %w", err)
	}
	var link PendingLink
	if err = json.Unmarshal([]byte(blob), &link); err != nil {
		return PendingLink{}, false, fmt.Errorf("tokens: unmarshal pending link: %w", err)
	}
	return link, true, nil
}

// ConsumePendingLink burns a pending-link token (single-use). Idempotent: deleting an
// already-consumed or expired key is not an error.
func (s *RedisTokens) ConsumePendingLink(ctx context.Context, raw string) error {
	if err := s.rdb.Del(ctx, key(nsPendingLink, raw)).Err(); err != nil {
		return fmt.Errorf("tokens: consume pending link: %w", err)
	}
	return nil
}
