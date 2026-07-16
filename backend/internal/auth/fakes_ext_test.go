package auth

import (
	"context"
	"maps"
	"strconv"
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

// --- fakeUserStore OAuth methods ---

// accountKey is the (provider, providerAccountId) composite the fake indexes accounts by.
func accountKey(provider, providerAccountID string) string {
	return provider + "|" + providerAccountID
}

// addAccount seeds a linked OAuth account (and its owning user's account-email index).
func (f *fakeUserStore) addAccount(a sqlcdb.Account) {
	f.accounts[accountKey(a.Provider, a.ProviderAccountId)] = a
	if a.Email != nil {
		if u, ok := f.byID[a.UserId]; ok {
			f.byAccountEmail[*a.Email] = u
		}
	}
}

func (f *fakeUserStore) GetProviderAccount(
	_ context.Context,
	arg sqlcdb.GetProviderAccountParams,
) (sqlcdb.Account, error) {
	if f.accountErr != nil {
		return sqlcdb.Account{}, f.accountErr
	}
	if a, ok := f.accounts[accountKey(arg.Provider, arg.ProviderAccountId)]; ok {
		return a, nil
	}
	return sqlcdb.Account{}, pgx.ErrNoRows
}

// GetUserWithOAuthConflict mirrors the query: a user reachable by email (primary,
// verified credential, or linked account email) who has NOT linked arg.Provider.
func (f *fakeUserStore) GetUserWithOAuthConflict(
	_ context.Context,
	arg sqlcdb.GetUserWithOAuthConflictParams,
) (sqlcdb.GetUserWithOAuthConflictRow, error) {
	if f.conflictErr != nil {
		return sqlcdb.GetUserWithOAuthConflictRow{}, f.conflictErr
	}
	for u := range maps.Values(f.byID) {
		reachable := u.Email == arg.Email ||
			(u.CredentialEmail != nil && *u.CredentialEmail == arg.Email && u.CredentialEmailVerified != nil) ||
			f.userHasAccountEmail(u.ID, arg.Email)
		if reachable && !f.userHasProvider(u.ID, arg.Provider) {
			return sqlcdb.GetUserWithOAuthConflictRow{ID: u.ID, Email: u.Email, Password: u.Password}, nil
		}
	}
	return sqlcdb.GetUserWithOAuthConflictRow{}, pgx.ErrNoRows
}

func (f *fakeUserStore) userHasProvider(userID, provider string) bool {
	for a := range maps.Values(f.accounts) {
		if a.UserId == userID && a.Provider == provider {
			return true
		}
	}
	return false
}

func (f *fakeUserStore) userHasAccountEmail(userID, email string) bool {
	for a := range maps.Values(f.accounts) {
		if a.UserId == userID && a.Email != nil && *a.Email == email {
			return true
		}
	}
	return false
}

func (f *fakeUserStore) CreateOAuthUser(
	_ context.Context,
	arg sqlcdb.CreateOAuthUserParams,
) (sqlcdb.User, error) {
	if f.oauthUserErr != nil {
		return sqlcdb.User{}, f.oauthUserErr
	}
	if _, taken := f.byEmail[arg.Email]; taken {
		return sqlcdb.User{}, pgUnique()
	}
	u := sqlcdb.User{
		ID:            arg.ID,
		Email:         arg.Email,
		Name:          arg.Name,
		Image:         arg.Image,
		EmailVerified: arg.EmailVerified,
	}
	f.add(u)
	return u, nil
}

func (f *fakeUserStore) CreateAccount(_ context.Context, arg sqlcdb.CreateAccountParams) error {
	if f.forceAcctUnique {
		return pgUnique()
	}
	if f.accountWriteErr != nil {
		return f.accountWriteErr
	}
	if _, exists := f.accounts[accountKey(arg.Provider, arg.ProviderAccountId)]; exists {
		return pgUnique()
	}
	f.addAccount(sqlcdb.Account{
		ID:                arg.ID,
		UserId:            arg.UserId,
		Type:              arg.Type,
		Provider:          arg.Provider,
		ProviderAccountId: arg.ProviderAccountId,
		AccessToken:       arg.AccessToken,
		RefreshToken:      arg.RefreshToken,
		ExpiresAt:         arg.ExpiresAt,
		TokenType:         arg.TokenType,
		Scope:             arg.Scope,
		IDToken:           arg.IDToken,
		SessionState:      arg.SessionState,
		Email:             arg.Email,
	})
	return nil
}

func (f *fakeUserStore) BackfillOAuthAccountEmail(
	_ context.Context,
	arg sqlcdb.BackfillOAuthAccountEmailParams,
) error {
	if f.backfillErr != nil {
		return f.backfillErr
	}
	if arg.Email != nil {
		f.backfilled[accountKey(arg.Provider, arg.ProviderAccountId)] = *arg.Email
	}
	return nil
}

// --- fakeTokens: behavioral one-time-token store ---

type fakeTokens struct {
	verify        map[string]string
	reset         map[string]string
	cred          map[string]CredentialEmailPayload
	states        map[string]OAuthState  // oauth state token -> stored state
	pending       map[string]PendingLink // pending-link token -> payload
	recentlySent  bool
	createErr     error
	consumeErr    error // ConsumeCredentialEmail (atomic burn) failure
	verifyPeekErr error // PeekVerification failure
	verifyBurnErr error // ConsumeVerification (burn) failure
	resetPeekErr  error // PeekPasswordReset failure
	resetBurnErr  error // ConsumePasswordReset (burn) failure
	credPeekErr   error // PeekCredentialEmail failure
	recentSentErr error // VerificationRecentlySent failure
	stateErr      error // ConsumeOAuthState failure
	pendingErr    error // PeekPendingLink failure
	nextToken     int   // monotonic counter for unique raw tokens
}

func newFakeTokens() *fakeTokens {
	return &fakeTokens{
		verify:  map[string]string{},
		reset:   map[string]string{},
		cred:    map[string]CredentialEmailPayload{},
		states:  map[string]OAuthState{},
		pending: map[string]PendingLink{},
	}
}

func (f *fakeTokens) CreateOAuthState(_ context.Context, state OAuthState) (string, error) {
	if f.createErr != nil {
		return "", f.createErr
	}
	f.nextToken++
	raw := "state-" + strconv.Itoa(f.nextToken)
	f.states[raw] = state
	return raw, nil
}

func (f *fakeTokens) ConsumeOAuthState(_ context.Context, raw string) (OAuthState, bool, error) {
	if f.stateErr != nil {
		return OAuthState{}, false, f.stateErr
	}
	state, ok := f.states[raw]
	delete(f.states, raw) // single-use
	return state, ok, nil
}

func (f *fakeTokens) CreatePendingLink(_ context.Context, link PendingLink) (string, error) {
	if f.createErr != nil {
		return "", f.createErr
	}
	f.nextToken++
	raw := "plink-" + strconv.Itoa(f.nextToken)
	f.pending[raw] = link
	return raw, nil
}

func (f *fakeTokens) PeekPendingLink(_ context.Context, raw string) (PendingLink, bool, error) {
	if f.pendingErr != nil {
		return PendingLink{}, false, f.pendingErr
	}
	link, ok := f.pending[raw]
	return link, ok, nil // non-destructive
}

func (f *fakeTokens) ConsumePendingLink(_ context.Context, raw string) error {
	delete(f.pending, raw)
	return nil
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
