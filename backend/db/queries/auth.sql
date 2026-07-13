-- name: GetUserByID :one
-- Resolve the session's user. id comes from the session cookie, never user input.
SELECT * FROM users WHERE id = $1;

-- name: GetUserByEmail :one
-- Credentials login / account lookup by email (primary email, unique).
SELECT * FROM users WHERE email = $1;

-- name: GetUserByVerifiedCredentialEmail :one
-- Credentials-login fallback: a *verified* credential sign-in email that differs
-- from the primary email. Unverified credential emails never authenticate, so the
-- NOT NULL guard is part of the match, not a post-filter.
SELECT * FROM users
WHERE "credentialEmail" = $1 AND "credentialEmailVerified" IS NOT NULL;

-- name: GetUnverifiedUserByEmail :one
-- Resend-verification target: an account registered with credentials whose primary
-- email is not yet verified. Returns nothing for verified or non-existent accounts.
SELECT id, "emailVerified" FROM users
WHERE email = $1 AND "emailVerified" IS NULL;

-- name: GetUserByAccountEmail :one
-- Any-email resolution fallback: the user who owns a linked OAuth account whose
-- provider email matches. Used by register/forgot-password to find an existing
-- account behind an OAuth-only identity.
-- ORDER BY makes the single-row pick deterministic when the same provider email is
-- linked to more than one user (accounts.email is nullable and not unique per user):
-- always resolve to the oldest account rather than an arbitrary one.
SELECT users.* FROM users
JOIN accounts ON accounts."userId" = users.id
WHERE accounts.email = $1
ORDER BY users."createdAt" ASC, users.id ASC
LIMIT 1;

-- name: GetProviderAccount :one
-- OAuth callback lookup: is this exact (provider, providerAccountId) already linked,
-- and to whom? Drives the link-intent / conflict branches.
SELECT * FROM accounts
WHERE provider = $1 AND "providerAccountId" = $2;

-- name: GetUserWithOAuthConflict :one
-- OAuth sign-in conflict detection (parity: getUserWithOAuthConflict). Finds an
-- existing account reachable by this OAuth email — via its primary email, a linked
-- account email, or a *verified* credential email — that has NOT yet linked this
-- provider. A hit means "an account owns this address but hasn't connected this
-- provider", so the callback routes to the password-confirm link flow instead of
-- silently creating a duplicate user. ORDER BY makes the pick deterministic when the
-- address matches more than one row (the cross-column email/credentialEmail case).
SELECT users.id, users.email, users.password FROM users
WHERE (
        users.email = $1
        OR (users."credentialEmail" = $1 AND users."credentialEmailVerified" IS NOT NULL)
        OR EXISTS (SELECT 1 FROM accounts a WHERE a."userId" = users.id AND a.email = $1)
    )
    AND NOT EXISTS (
        SELECT 1 FROM accounts ap WHERE ap."userId" = users.id AND ap.provider = $2
    )
ORDER BY users."createdAt" ASC, users.id ASC
LIMIT 1;

-- name: CreateOAuthUser :one
-- New OAuth sign-up: create the user row for a first-time OAuth identity with no
-- existing account. emailVerified is set (now) only when the provider asserts the
-- email is verified, NULL otherwise, so an unverified OAuth email never counts as a
-- verified primary. A unique violation on email surfaces as 23505.
INSERT INTO users (id, email, name, image, "emailVerified", "updatedAt")
VALUES ($1, $2, $3, $4, $5, now())
RETURNING *;

-- name: CreateAccount :exec
-- Link an OAuth account to a user (new sign-up or password-confirmed link). The
-- (provider, providerAccountId) unique index makes a concurrent double-link surface
-- as 23505, which the caller treats as an idempotent success.
INSERT INTO accounts (
    id, "userId", type, provider, "providerAccountId",
    access_token, refresh_token, expires_at, token_type, scope, id_token, session_state, email
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13);

-- name: BackfillOAuthAccountEmail :exec
-- Fill in a linked account's provider email on a later sign-in when it was created
-- without one (parity: backfillOAuthAccountEmail). Only touches rows whose email is
-- still NULL, so it never overwrites a stored value.
UPDATE accounts SET email = $3
WHERE provider = $1 AND "providerAccountId" = $2 AND email IS NULL;

-- name: InsertCredentialUser :one
-- Register a new credentials account. emailVerified/credentialEmailVerified are
-- set (now) when verification is disabled, NULL otherwise. A unique violation on
-- email/credentialEmail surfaces as 23505 → the caller maps it to "in use".
INSERT INTO users (
    id, email, name, password, "emailVerified", "credentialEmail", "credentialEmailVerified", "updatedAt"
) VALUES ($1, $2, $3, $4, $5, $6, $7, now())
RETURNING *;

-- name: UpdateUserPassword :exec
-- Reset the password of an already-verified credential account (id from a consumed
-- reset token, never user input).
UPDATE users SET password = $2, "updatedAt" = now() WHERE id = $1;

-- name: BootstrapCredentialLogin :exec
-- Reset path for an OAuth-only account (no prior password): set the password and
-- verify both the primary and credential email in lockstep.
UPDATE users
SET password = $2,
    "emailVerified" = now(),
    "credentialEmail" = $3,
    "credentialEmailVerified" = now(),
    "updatedAt" = now()
WHERE id = $1;

-- name: SetPasswordAndVerifyEmail :exec
-- Reset path for an unverified credential account: set the password, verify the
-- primary email, and verify the credential email too iff it equals $3 (in sync).
UPDATE users
SET password = $2,
    "emailVerified" = now(),
    "credentialEmailVerified" = CASE WHEN "credentialEmail" = $3 THEN now() ELSE "credentialEmailVerified" END,
    "updatedAt" = now()
WHERE id = $1;

-- name: MarkEmailVerifiedByEmail :exec
-- Verify-email link consume: mark the primary email verified (and the credential
-- email too when they match). No-op if already verified or the account is gone.
UPDATE users
SET "emailVerified" = now(),
    "credentialEmailVerified" = CASE WHEN "credentialEmail" = email THEN now() ELSE "credentialEmailVerified" END,
    "updatedAt" = now()
WHERE email = $1 AND "emailVerified" IS NULL;

-- name: ChangeCredentialEmail :exec
-- Confirm-login-email (user already has a password): re-point the credential email
-- and verify it. If the primary email was in sync with the old credential email,
-- move it too. Unique violation → 23505.
UPDATE users
SET "credentialEmail" = $2,
    "credentialEmailVerified" = now(),
    email = CASE WHEN email = "credentialEmail" THEN $2 ELSE email END,
    "updatedAt" = now()
WHERE id = $1;

-- name: SetCredentialEmailLogin :exec
-- Confirm-login-email (OAuth-only account adding a password): set the password and
-- the verified credential email. Unique violation on credentialEmail → 23505.
UPDATE users
SET password = $2,
    "credentialEmail" = $3,
    "credentialEmailVerified" = now(),
    "updatedAt" = now()
WHERE id = $1;
