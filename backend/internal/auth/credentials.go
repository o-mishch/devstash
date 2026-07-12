package auth

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"

	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
)

// dummyPasswordHash is compared against when no credential user is found, so a
// missing account costs the same bcrypt work as a wrong password — no timing
// oracle for account enumeration. Value copied verbatim from the Next app so both
// stacks are indistinguishable. It is a hash of a random string, not a real secret.
// #nosec G101
const dummyPasswordHash = "$2b$12$/aPGheK5yMwWRHblAh2yH.yldP9ajZcNbVAPj.ph67Gnnad6drare"

// bcryptCost is the hashing cost for new/rotated passwords. Matches the Next app's
// BCRYPT_ROUNDS so hashes are interchangeable across the two stacks.
const bcryptCost = 12

// hashForStorage bcrypt-hashes a password for persistence.
func hashForStorage(password string) (string, error) {
	h, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
	if err != nil {
		return "", fmt.Errorf("auth: hash password: %w", err)
	}
	return string(h), nil
}

// credentialMatch is a successful credential validation: the user and whether the
// email that matched is verified (drives the pre-login "verify your email" gate).
type credentialMatch struct {
	user            sqlcdb.User
	matchedVerified bool
}

// validateCredential looks up the user by primary email then by verified credential
// email, and constant-time-checks the password. ok is false for a wrong password,
// a missing account, or an OAuth-only account (no password) — without leaking which,
// since every path spends one bcrypt comparison. A non-nil error is a real DB
// failure (the caller maps it to 500), distinct from ok=false. Parity: validateUserPassword.
func (s *Service) validateCredential(ctx context.Context, email, password string) (credentialMatch, bool, error) {
	user, matchedPrimary, found, err := s.lookupCredentialUser(ctx, email)
	if err != nil {
		return credentialMatch{}, false, err
	}
	if !found || user.Password == nil {
		// Constant-time miss: compare against the dummy hash so a nonexistent or
		// passwordless account is timing-indistinguishable from a wrong password.
		_ = bcrypt.CompareHashAndPassword([]byte(dummyPasswordHash), []byte(password))
		return credentialMatch{}, false, nil
	}
	// A bcrypt mismatch is a wrong password, not a failure — ok=false, err=nil.
	passwordMatches := bcrypt.CompareHashAndPassword([]byte(*user.Password), []byte(password)) == nil
	if !passwordMatches {
		return credentialMatch{}, false, nil
	}

	// A credential-email match is verified by construction (the query filters on
	// credentialEmailVerified IS NOT NULL); a primary-email match gates on emailVerified.
	matchedVerified := true
	if matchedPrimary {
		matchedVerified = user.EmailVerified != nil
	}
	return credentialMatch{user: user, matchedVerified: matchedVerified}, true, nil
}

// lookupCredentialUser resolves the credential-login user: primary email first,
// then a verified credential email. A no-rows result falls through to the next
// lookup; any other error is a real DB failure and is returned. matchedPrimary
// reports which lookup hit (it gates the emailVerified check in the caller).
func (s *Service) lookupCredentialUser(
	ctx context.Context,
	email string,
) (sqlcdb.User, bool, bool, error) {
	u, found, err := tryLookup(func() (sqlcdb.User, error) { return s.Users.GetUserByEmail(ctx, email) })
	if err != nil {
		return sqlcdb.User{}, false, false, err
	}
	if found {
		return u, true, true, nil // matched the primary email
	}
	u, found, err = tryLookup(func() (sqlcdb.User, error) {
		return s.Users.GetUserByVerifiedCredentialEmail(ctx, &email)
	})
	if err != nil {
		return sqlcdb.User{}, false, false, err
	}
	return u, false, found, nil
}

// tryLookup runs a single sqlc user lookup and classifies its result once: found=true
// on a hit, found=false on pgx.ErrNoRows (a clean miss, not an error), and a non-nil
// error only for a real DB failure. It collapses the repeated
// err==nil / ErrNoRows / else ladder shared by the credential and any-email lookups.
func tryLookup(fn func() (sqlcdb.User, error)) (sqlcdb.User, bool, error) {
	u, err := fn()
	switch {
	case err == nil:
		return u, true, nil
	case errors.Is(err, pgx.ErrNoRows):
		return sqlcdb.User{}, false, nil
	default:
		return sqlcdb.User{}, false, err
	}
}
