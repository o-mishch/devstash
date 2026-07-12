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
