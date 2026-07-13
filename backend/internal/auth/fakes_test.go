package auth

import (
	"context"
	"log/slog"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"

	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
	"github.com/o-mishch/devstash/backend/internal/ratelimit"
)

func discardLogger() *slog.Logger { return slog.New(slog.DiscardHandler) }

// fakeUserStore is an in-memory UserStore. Lookups miss with pgx.ErrNoRows (as the
// sqlc layer does); a preset err simulates a real DB failure on the email lookups.
type fakeUserStore struct {
	byID            map[string]sqlcdb.User
	byEmail         map[string]sqlcdb.User
	byCredEmail     map[string]sqlcdb.User    // verified credential emails only
	byAccountEmail  map[string]sqlcdb.User    // linked OAuth account emails
	accounts        map[string]sqlcdb.Account // linked OAuth accounts, keyed provider|providerAccountId
	emailErr        error                     // returned by the email lookups when set
	idErr           error                     // returned by GetUserByID when set
	forceUnique     bool                      // makes credential writes return a 23505
	credWriteErr    error                     // makes credential writes return a non-unique DB error
	insertRace      sqlcdb.User               // if set, InsertCredentialUser 23505s once, then this row appears
	insertErr       error                     // returned by InsertCredentialUser when set (a non-unique DB failure)
	pwWriteErr      error                     // returned by the password writes (Update/SetPasswordAndVerify/Bootstrap) when set
	markVerifiedErr error                     // returned by MarkEmailVerifiedByEmail when set
	accountErr      error                     // returned by GetProviderAccount when set (a real DB failure)
	conflictErr     error                     // returned by GetUserWithOAuthConflict when set
	oauthUserErr    error                     // returned by CreateOAuthUser when set
	accountWriteErr error                     // returned by CreateAccount when set (a non-unique DB failure)
	forceAcctUnique bool                      // makes CreateAccount return a 23505
	backfillErr     error                     // returned by BackfillOAuthAccountEmail when set
	backfilled      map[string]string         // provider|providerAccountId -> email backfilled
}

func newFakeUserStore() *fakeUserStore {
	return &fakeUserStore{
		byID:           map[string]sqlcdb.User{},
		byEmail:        map[string]sqlcdb.User{},
		byCredEmail:    map[string]sqlcdb.User{},
		byAccountEmail: map[string]sqlcdb.User{},
		accounts:       map[string]sqlcdb.Account{},
		backfilled:     map[string]string{},
	}
}

func (f *fakeUserStore) GetUserByID(_ context.Context, id string) (sqlcdb.User, error) {
	if f.idErr != nil {
		return sqlcdb.User{}, f.idErr
	}
	if u, ok := f.byID[id]; ok {
		return u, nil
	}
	return sqlcdb.User{}, pgx.ErrNoRows
}

func (f *fakeUserStore) GetUserByEmail(_ context.Context, email string) (sqlcdb.User, error) {
	if f.emailErr != nil {
		return sqlcdb.User{}, f.emailErr
	}
	if u, ok := f.byEmail[email]; ok {
		return u, nil
	}
	return sqlcdb.User{}, pgx.ErrNoRows
}

func (f *fakeUserStore) GetUserByVerifiedCredentialEmail(_ context.Context, email *string) (sqlcdb.User, error) {
	if f.emailErr != nil {
		return sqlcdb.User{}, f.emailErr
	}
	if email != nil {
		if u, ok := f.byCredEmail[*email]; ok {
			return u, nil
		}
	}
	return sqlcdb.User{}, pgx.ErrNoRows
}

func (f *fakeUserStore) add(u sqlcdb.User) {
	f.byID[u.ID] = u
	f.byEmail[u.Email] = u
	if u.CredentialEmail != nil && u.CredentialEmailVerified != nil {
		f.byCredEmail[*u.CredentialEmail] = u
	}
}

// fakeSessions records what the handlers do to the session.
type fakeSessions struct {
	authedUserID string
	authedFP     string
	authErr      error
	destroyed    bool
	destroyErr   error
	deadline     time.Time
}

func (f *fakeSessions) Authenticate(_ context.Context, userID, pwFingerprint string) error {
	if f.authErr != nil {
		return f.authErr
	}
	f.authedUserID = userID
	f.authedFP = pwFingerprint
	return nil
}

func (f *fakeSessions) Destroy(_ context.Context) error {
	f.destroyed = true
	return f.destroyErr
}

func (f *fakeSessions) Deadline(_ context.Context) time.Time { return f.deadline }

// fakeLimiter denies the buckets named in deny; err simulates a Redis outage.
type fakeLimiter struct {
	deny       map[string]bool
	retryAfter time.Duration
	err        error
	calls      []string
}

func (f *fakeLimiter) Allow(_ context.Context, bucket, key string) (ratelimit.Decision, error) {
	f.calls = append(f.calls, bucket+"|"+key)
	if f.err != nil {
		return ratelimit.Decision{}, f.err
	}
	if f.deny[bucket] {
		return ratelimit.Decision{Allowed: false, RetryAfter: f.retryAfter}, nil
	}
	return ratelimit.Decision{Allowed: true}, nil
}

// hashPassword bcrypt-hashes at the minimum cost (fast) for tests.
func hashPassword(t *testing.T, password string) string {
	t.Helper()
	h, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	return string(h)
}
