package auth

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
)

// pgUnique returns a Postgres unique-violation error, as the driver would on a
// duplicate email/credentialEmail insert or update.
func pgUnique() error { return &pgconn.PgError{Code: "23505"} }

// --- fakeUserStore write + extra-read methods (interface completion) ---

func (f *fakeUserStore) GetUserByAccountEmail(_ context.Context, email *string) (sqlcdb.User, error) {
	if f.emailErr != nil {
		return sqlcdb.User{}, f.emailErr
	}
	if email != nil {
		if u, ok := f.byAccountEmail[*email]; ok {
			return u, nil
		}
	}
	return sqlcdb.User{}, pgx.ErrNoRows
}

func (f *fakeUserStore) GetUnverifiedUserByEmail(
	_ context.Context,
	email string,
) (sqlcdb.GetUnverifiedUserByEmailRow, error) {
	if f.emailErr != nil {
		return sqlcdb.GetUnverifiedUserByEmailRow{}, f.emailErr
	}
	if u, ok := f.byEmail[email]; ok && u.EmailVerified == nil {
		return sqlcdb.GetUnverifiedUserByEmailRow{ID: u.ID, EmailVerified: u.EmailVerified}, nil
	}
	return sqlcdb.GetUnverifiedUserByEmailRow{}, pgx.ErrNoRows
}

func (f *fakeUserStore) InsertCredentialUser(
	_ context.Context,
	arg sqlcdb.InsertCredentialUserParams,
) (sqlcdb.User, error) {
	if f.insertErr != nil {
		return sqlcdb.User{}, f.insertErr
	}
	// Simulate a lost insert race: 23505 once, and the racing row now exists so the
	// caller's re-resolve finds it.
	if f.insertRace.ID != "" {
		raced := f.insertRace
		f.insertRace = sqlcdb.User{}
		f.add(raced)
		return sqlcdb.User{}, pgUnique()
	}
	if _, taken := f.byEmail[arg.Email]; taken {
		return sqlcdb.User{}, pgUnique()
	}
	u := sqlcdb.User{
		ID:                      arg.ID,
		Email:                   arg.Email,
		Name:                    arg.Name,
		Password:                arg.Password,
		EmailVerified:           arg.EmailVerified,
		CredentialEmail:         arg.CredentialEmail,
		CredentialEmailVerified: arg.CredentialEmailVerified,
	}
	f.add(u)
	return u, nil
}

func (f *fakeUserStore) UpdateUserPassword(_ context.Context, arg sqlcdb.UpdateUserPasswordParams) error {
	if f.pwWriteErr != nil {
		return f.pwWriteErr
	}
	u := f.byID[arg.ID]
	u.Password = arg.Password
	f.add(u)
	return nil
}

func (f *fakeUserStore) BootstrapCredentialLogin(_ context.Context, arg sqlcdb.BootstrapCredentialLoginParams) error {
	if f.forceUnique {
		return pgUnique()
	}
	if f.pwWriteErr != nil {
		return f.pwWriteErr
	}
	u := f.byID[arg.ID]
	now := time.Now()
	u.Password = arg.Password
	u.EmailVerified = &now
	u.CredentialEmail = arg.CredentialEmail
	u.CredentialEmailVerified = &now
	f.add(u)
	return nil
}

func (f *fakeUserStore) SetPasswordAndVerifyEmail(_ context.Context, arg sqlcdb.SetPasswordAndVerifyEmailParams) error {
	if f.pwWriteErr != nil {
		return f.pwWriteErr
	}
	u := f.byID[arg.ID]
	now := time.Now()
	u.Password = arg.Password
	u.EmailVerified = &now
	f.add(u)
	return nil
}

func (f *fakeUserStore) MarkEmailVerifiedByEmail(_ context.Context, email string) error {
	if f.markVerifiedErr != nil {
		return f.markVerifiedErr
	}
	if u, ok := f.byEmail[email]; ok && u.EmailVerified == nil {
		now := time.Now()
		u.EmailVerified = &now
		f.add(u)
	}
	return nil
}

func (f *fakeUserStore) ChangeCredentialEmail(_ context.Context, arg sqlcdb.ChangeCredentialEmailParams) error {
	if f.forceUnique {
		return pgUnique()
	}
	if f.credWriteErr != nil {
		return f.credWriteErr
	}
	u := f.byID[arg.ID]
	u.CredentialEmail = arg.CredentialEmail
	f.add(u)
	return nil
}

func (f *fakeUserStore) SetCredentialEmailLogin(_ context.Context, arg sqlcdb.SetCredentialEmailLoginParams) error {
	if f.forceUnique {
		return pgUnique()
	}
	if f.credWriteErr != nil {
		return f.credWriteErr
	}
	u := f.byID[arg.ID]
	u.Password = arg.Password
	u.CredentialEmail = arg.CredentialEmail
	f.add(u)
	return nil
}

// --- fakeTokens: behavioral one-time-token store ---

type fakeTokens struct {
	verify        map[string]string
	reset         map[string]string
	cred          map[string]CredentialEmailPayload
	recentlySent  bool
	createErr     error
	consumeErr    error // ConsumeCredentialEmail (atomic burn) failure
	verifyPeekErr error // PeekVerification failure
	verifyBurnErr error // ConsumeVerification (burn) failure
	resetPeekErr  error // PeekPasswordReset failure
	resetBurnErr  error // ConsumePasswordReset (burn) failure
	credPeekErr   error // PeekCredentialEmail failure
	recentSentErr error // VerificationRecentlySent failure
}

func newFakeTokens() *fakeTokens {
	return &fakeTokens{
		verify: map[string]string{},
		reset:  map[string]string{},
		cred:   map[string]CredentialEmailPayload{},
	}
}

func (f *fakeTokens) CreateVerification(_ context.Context, email string) (string, error) {
	if f.createErr != nil {
		return "", f.createErr
	}
	raw := "verify-" + email
	f.verify[raw] = email
	return raw, nil
}

func (f *fakeTokens) PeekVerification(_ context.Context, raw string) (string, bool, error) {
	if f.verifyPeekErr != nil {
		return "", false, f.verifyPeekErr
	}
	email, ok := f.verify[raw]
	return email, ok, nil // non-destructive
}

func (f *fakeTokens) ConsumeVerification(_ context.Context, raw string) error {
	if f.verifyBurnErr != nil {
		return f.verifyBurnErr
	}
	delete(f.verify, raw)
	return nil
}

func (f *fakeTokens) VerificationRecentlySent(_ context.Context, _ string) (bool, error) {
	if f.recentSentErr != nil {
		return false, f.recentSentErr
	}
	return f.recentlySent, nil
}

func (f *fakeTokens) CreatePasswordReset(_ context.Context, email string) (string, error) {
	if f.createErr != nil {
		return "", f.createErr
	}
	raw := "reset-" + email
	f.reset[raw] = email
	return raw, nil
}

func (f *fakeTokens) PeekPasswordReset(_ context.Context, raw string) (string, bool, error) {
	if f.resetPeekErr != nil {
		return "", false, f.resetPeekErr
	}
	email, ok := f.reset[raw]
	return email, ok, nil // non-destructive
}

func (f *fakeTokens) ConsumePasswordReset(_ context.Context, raw string) error {
	if f.resetBurnErr != nil {
		return f.resetBurnErr
	}
	delete(f.reset, raw)
	return nil
}

func (f *fakeTokens) CreateCredentialEmail(
	_ context.Context,
	userID, email string,
) (string, error) {
	if f.createErr != nil {
		return "", f.createErr
	}
	raw := "cred-" + userID
	f.cred[raw] = CredentialEmailPayload{UserID: userID, Email: email, Gen: 1}
	return raw, nil
}

func (f *fakeTokens) PeekCredentialEmail(_ context.Context, raw string) (CredentialEmailPayload, bool, error) {
	if f.credPeekErr != nil {
		return CredentialEmailPayload{}, false, f.credPeekErr
	}
	p, ok := f.cred[raw]
	return p, ok, nil // non-destructive
}

func (f *fakeTokens) ConsumeCredentialEmail(
	_ context.Context,
	raw string,
	_ CredentialEmailPayload,
) (bool, error) {
	if f.consumeErr != nil {
		return false, f.consumeErr
	}
	_, ok := f.cred[raw]
	delete(f.cred, raw)
	return ok, nil
}

func (f *fakeTokens) SetVerificationSent(_ context.Context, _ string) error {
	f.recentlySent = true
	return nil
}

// --- fakeEmailer: records what was sent ---

type sentNotification struct {
	to    string
	event SecurityEvent
}

type fakeEmailer struct {
	verifications []string
	resets        []string
	notifications []sentNotification
	err           error
}

func (f *fakeEmailer) SendVerification(_ context.Context, to, _ string) error {
	f.verifications = append(f.verifications, to)
	return f.err
}

func (f *fakeEmailer) SendPasswordReset(_ context.Context, to, _ string) error {
	f.resets = append(f.resets, to)
	return f.err
}

func (f *fakeEmailer) SendSecurityNotification(_ context.Context, to string, event SecurityEvent) error {
	f.notifications = append(f.notifications, sentNotification{to: to, event: event})
	return f.err
}
