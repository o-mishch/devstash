package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2/humatest"

	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
	"github.com/o-mishch/devstash/backend/internal/ratelimit"
)

const testAppURL = "https://beta.devstash.one"

// fakeOAuthProvider is an in-memory OAuthProvider — the external token-exchange seam,
// hand-faked (like fakeEmailer) so the callback branching is tested without real HTTP.
type fakeOAuthProvider struct {
	name        string
	authURL     string
	identity    OAuthIdentity
	exchangeErr error
	lastState   string
	exchanges   int
}

func (p *fakeOAuthProvider) Name() string { return p.name }

func (p *fakeOAuthProvider) AuthCodeURL(state string) string {
	p.lastState = state
	return p.authURL + "?state=" + state
}

func (p *fakeOAuthProvider) Exchange(_ context.Context, _ string) (OAuthIdentity, error) {
	p.exchanges++
	if p.exchangeErr != nil {
		return OAuthIdentity{}, p.exchangeErr
	}
	return p.identity, nil
}

// idSeq is a deterministic id generator for tests (production uses UUIDv7).
func idSeq() func() string {
	n := 0
	return func() string {
		n++
		return "id-" + strconv.Itoa(n)
	}
}

// oauthFixture bundles a registered OAuth Service with its fakes.
type oauthFixture struct {
	store   *fakeUserStore
	tokens  *fakeTokens
	sess    *fakeSessions
	limiter *fakeLimiter
	email   *fakeEmailer
	gh      *fakeOAuthProvider
	api     humatest.TestAPI
}

func newOAuthFixture(t *testing.T) *oauthFixture {
	t.Helper()
	gh := &fakeOAuthProvider{
		name:    providerGitHub,
		authURL: "https://github.com/login/oauth/authorize",
		identity: OAuthIdentity{
			Provider:          providerGitHub,
			Type:              accountTypeOAuth,
			ProviderAccountID: "gh-1",
			Email:             "new@example.com",
			EmailVerified:     true,
			Name:              new("New User"),
			Image:             new("https://img/avatar.png"),
			Tokens:            OAuthTokens{AccessToken: new("gh-access")},
		},
	}
	f := &oauthFixture{
		store:   newFakeUserStore(),
		tokens:  newFakeTokens(),
		sess:    &fakeSessions{},
		limiter: &fakeLimiter{},
		email:   &fakeEmailer{},
		gh:      gh,
	}
	svc := New(Deps{
		Users:     f.store,
		Sessions:  f.sess,
		Limiter:   f.limiter,
		Tokens:    f.tokens,
		Email:     f.email,
		Providers: map[string]OAuthProvider{providerGitHub: gh},
		IDs:       idSeq(),
		Logger:    discardLogger(),
		Cfg:       Config{AppURL: testAppURL},
	})
	_, api := humatest.New(t)
	registerOAuth(api, svc)
	f.api = api
	return f
}

// seedState mints a valid github state token and returns the raw value.
func (f *oauthFixture) seedState(t *testing.T, provider string) string {
	t.Helper()
	raw, err := f.tokens.CreateOAuthState(t.Context(), provider)
	if err != nil {
		t.Fatalf("seed state: %v", err)
	}
	return raw
}

// callback issues the github callback GET with the given query.
func (f *oauthFixture) callback(query string) *httptest.ResponseRecorder {
	return f.api.Get("/auth/oauth/github/callback?" + query)
}

// mintState creates a state token for provider, ignoring the error (fakeTokens only
// errors when explicitly primed, which these callers don't do). Used from table
// closures that have no *testing.T in scope.
func mintState(f *oauthFixture, provider string) string {
	raw, _ := f.tokens.CreateOAuthState(context.Background(), provider)
	return raw
}

func TestOAuthStartRedirects(t *testing.T) {
	t.Parallel()
	f := newOAuthFixture(t)

	resp := f.api.Get("/auth/oauth/github/start")

	if resp.Code != http.StatusFound {
		t.Fatalf("status = %d, want 302; body = %s", resp.Code, resp.Body.String())
	}
	loc := resp.Header().Get("Location")
	if !strings.HasPrefix(loc, f.gh.authURL) {
		t.Errorf("Location = %q, want prefix %q", loc, f.gh.authURL)
	}
	if len(f.tokens.states) != 1 {
		t.Fatalf("states minted = %d, want 1", len(f.tokens.states))
	}
	// The state carried to the provider is the one stored for later validation.
	if !strings.Contains(loc, f.gh.lastState) {
		t.Errorf("Location %q does not carry state %q", loc, f.gh.lastState)
	}
	if _, ok := f.tokens.states[f.gh.lastState]; !ok {
		t.Errorf("state %q not stored for validation", f.gh.lastState)
	}
}

func TestOAuthStartStateError(t *testing.T) {
	t.Parallel()
	f := newOAuthFixture(t)
	f.tokens.createErr = errors.New("redis down")

	resp := f.api.Get("/auth/oauth/github/start")
	if resp.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body = %s", resp.Code, resp.Body.String())
	}
}

func TestOAuthCallbackNewUser(t *testing.T) {
	t.Parallel()
	f := newOAuthFixture(t)
	state := f.seedState(t, providerGitHub)

	resp := f.callback("state=" + state + "&code=abc")

	assertRedirect(t, resp, testAppURL+"/dashboard")
	// User + account created; session established.
	if len(f.store.byEmail) != 1 {
		t.Errorf("users created = %d, want 1", len(f.store.byEmail))
	}
	acct, err := f.store.GetProviderAccount(t.Context(), sqlcdb.GetProviderAccountParams{
		Provider: providerGitHub, ProviderAccountId: "gh-1",
	})
	if err != nil {
		t.Fatalf("account not created: %v", err)
	}
	if f.sess.authedUserID != acct.UserId {
		t.Errorf("session userID = %q, want %q", f.sess.authedUserID, acct.UserId)
	}
	if acct.Email == nil || *acct.Email != "new@example.com" {
		t.Errorf("account email = %v, want new@example.com", acct.Email)
	}
	// State is single-use: consumed by the callback.
	if len(f.tokens.states) != 0 {
		t.Errorf("state not consumed: %d remain", len(f.tokens.states))
	}
}

func TestOAuthCallbackNewUserUnverifiedEmail(t *testing.T) {
	t.Parallel()
	f := newOAuthFixture(t)
	f.gh.identity.EmailVerified = false
	state := f.seedState(t, providerGitHub)

	resp := f.callback("state=" + state + "&code=abc")
	assertRedirect(t, resp, testAppURL+"/dashboard")

	// emailVerified stays NULL when the provider didn't assert verification.
	u := f.store.byEmail["new@example.com"]
	if u.EmailVerified != nil {
		t.Errorf("emailVerified = %v, want nil for unverified OAuth email", u.EmailVerified)
	}
}

func TestOAuthCallbackReturningUser(t *testing.T) {
	t.Parallel()
	f := newOAuthFixture(t)
	f.store.add(sqlcdb.User{ID: "user-1", Email: "existing@example.com"})
	f.store.addAccount(sqlcdb.Account{
		ID: "acct-1", UserId: "user-1", Provider: providerGitHub, ProviderAccountId: "gh-1", Type: accountTypeOAuth,
	})
	state := f.seedState(t, providerGitHub)

	resp := f.callback("state=" + state + "&code=abc")

	assertRedirect(t, resp, testAppURL+"/dashboard")
	if f.sess.authedUserID != "user-1" {
		t.Errorf("session userID = %q, want user-1", f.sess.authedUserID)
	}
	// No new user created.
	if _, exists := f.store.byEmail["new@example.com"]; exists {
		t.Error("a new user was created for a returning identity")
	}
	// Missing account email was backfilled from the verified identity.
	if got := f.store.backfilled[accountKey(providerGitHub, "gh-1")]; got != "new@example.com" {
		t.Errorf("backfilled email = %q, want new@example.com", got)
	}
}

func TestOAuthCallbackConflict(t *testing.T) {
	t.Parallel()
	f := newOAuthFixture(t)
	// An existing account owns the identity email but has not linked github.
	f.store.add(sqlcdb.User{ID: "user-1", Email: "new@example.com", Password: new(hashPassword(t, testPassword))})
	state := f.seedState(t, providerGitHub)

	resp := f.callback("state=" + state + "&code=abc")

	if resp.Code != http.StatusFound {
		t.Fatalf("status = %d, want 302; body = %s", resp.Code, resp.Body.String())
	}
	loc := resp.Header().Get("Location")
	if !strings.HasPrefix(loc, testAppURL+"/link-account?token=") {
		t.Fatalf("Location = %q, want link-account redirect", loc)
	}
	// A pending link was minted carrying the primary email + identity.
	if len(f.tokens.pending) != 1 {
		t.Fatalf("pending links = %d, want 1", len(f.tokens.pending))
	}
	// No session established on the conflict path.
	if f.sess.authedUserID != "" {
		t.Error("session established on conflict path, want none")
	}
}

func TestOAuthCallbackDenied(t *testing.T) {
	t.Parallel()
	f := newOAuthFixture(t)

	resp := f.callback("error=access_denied")

	assertRedirect(t, resp, testAppURL+"/sign-in?error="+oauthErrDenied)
	if f.gh.exchanges != 0 {
		t.Error("provider exchange called on a denied callback")
	}
}

func TestOAuthCallbackStateFailures(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name  string
		query func(f *oauthFixture) string
		setup func(f *oauthFixture)
		want  string
	}{
		{
			name:  "unknown state",
			query: func(*oauthFixture) string { return "state=bogus&code=abc" },
			want:  oauthErrState,
		},
		{
			name:  "missing code",
			query: func(f *oauthFixture) string { return "state=" + mintState(f, providerGitHub) + "&code=" },
			want:  oauthErrState,
		},
		{
			name: "provider mismatch",
			// A state minted for google is replayed on the github callback.
			query: func(f *oauthFixture) string { return "state=" + mintState(f, providerGoogle) + "&code=abc" },
			want:  oauthErrState,
		},
		{
			name:  "state store error",
			query: func(*oauthFixture) string { return "state=x&code=abc" },
			setup: func(f *oauthFixture) { f.tokens.stateErr = errors.New("redis down") },
			want:  oauthErrServer,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			f := newOAuthFixture(t)
			if tc.setup != nil {
				tc.setup(f)
			}
			resp := f.callback(tc.query(f))
			assertRedirect(t, resp, testAppURL+"/sign-in?error="+tc.want)
		})
	}
}

func TestOAuthCallbackExchangeFailures(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name  string
		setup func(f *oauthFixture)
		want  string
	}{
		{
			name:  "exchange error",
			setup: func(f *oauthFixture) { f.gh.exchangeErr = errors.New("bad code") },
			want:  oauthErrExchange,
		},
		{
			name:  "no email",
			setup: func(f *oauthFixture) { f.gh.identity.Email = "" },
			want:  oauthErrNoEmail,
		},
		{
			name:  "provider-account lookup error",
			setup: func(f *oauthFixture) { f.store.accountErr = errors.New("db down") },
			want:  oauthErrServer,
		},
		{
			name:  "conflict lookup error",
			setup: func(f *oauthFixture) { f.store.conflictErr = errors.New("db down") },
			want:  oauthErrServer,
		},
		{
			name:  "create user error",
			setup: func(f *oauthFixture) { f.store.oauthUserErr = errors.New("db down") },
			want:  oauthErrServer,
		},
		{
			name:  "create account error",
			setup: func(f *oauthFixture) { f.store.accountWriteErr = errors.New("db down") },
			want:  oauthErrServer,
		},
		{
			name:  "establish session error",
			setup: func(f *oauthFixture) { f.sess.authErr = errors.New("redis down") },
			want:  oauthErrServer,
		},
		{
			name:  "pending-link create error",
			setup: func(f *oauthFixture) { seedConflictUser(f); f.tokens.createErr = errors.New("redis down") },
			want:  oauthErrServer,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			f := newOAuthFixture(t)
			state := f.seedState(t, providerGitHub)
			tc.setup(f)
			resp := f.callback("state=" + state + "&code=abc")
			assertRedirect(t, resp, testAppURL+"/sign-in?error="+tc.want)
		})
	}
}

// seedConflictUser makes the identity email resolve to an existing account with no github link.
func seedConflictUser(f *oauthFixture) {
	f.store.add(sqlcdb.User{ID: "user-1", Email: "new@example.com"})
}

func TestOAuthCallbackNewUserAccountRace(t *testing.T) {
	t.Parallel()
	f := newOAuthFixture(t)
	// A concurrent request already linked this identity: CreateAccount 23505s, folded to success.
	f.store.forceAcctUnique = true
	state := f.seedState(t, providerGitHub)

	resp := f.callback("state=" + state + "&code=abc")
	assertRedirect(t, resp, testAppURL+"/dashboard")
	if f.sess.authedUserID == "" {
		t.Error("session not established despite idempotent account race")
	}
}

func TestOAuthLinkSuccess(t *testing.T) {
	t.Parallel()
	f := newOAuthFixture(t)
	user := sqlcdb.User{ID: "user-1", Email: "owner@example.com", Password: new(hashPassword(t, testPassword))}
	f.store.add(user)
	token := seedPendingLink(t, f, user.Email)

	resp := f.api.Post("/auth/link", map[string]any{"token": token, "password": testPassword})

	if resp.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204; body = %s", resp.Code, resp.Body.String())
	}
	if f.sess.authedUserID != user.ID {
		t.Errorf("session userID = %q, want %q", f.sess.authedUserID, user.ID)
	}
	if _, err := f.store.GetProviderAccount(t.Context(), sqlcdb.GetProviderAccountParams{
		Provider: providerGitHub, ProviderAccountId: "gh-1",
	}); err != nil {
		t.Errorf("account not linked: %v", err)
	}
	if len(f.email.notifications) != 1 || f.email.notifications[0].event != SecurityMethodLinked {
		t.Errorf("notifications = %+v, want one method-linked", f.email.notifications)
	}
	if len(f.tokens.pending) != 0 {
		t.Error("pending link not consumed after successful link")
	}
}

func TestOAuthLinkAlreadyLinkedIsIdempotent(t *testing.T) {
	t.Parallel()
	f := newOAuthFixture(t)
	user := sqlcdb.User{ID: "user-1", Email: "owner@example.com", Password: new(hashPassword(t, testPassword))}
	f.store.add(user)
	f.store.addAccount(sqlcdb.Account{
		ID: "acct-1", UserId: user.ID, Provider: providerGitHub, ProviderAccountId: "gh-1", Type: accountTypeOAuth,
	})
	token := seedPendingLink(t, f, user.Email)

	resp := f.api.Post("/auth/link", map[string]any{"token": token, "password": testPassword})
	if resp.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204; body = %s", resp.Code, resp.Body.String())
	}
	if f.sess.authedUserID != user.ID {
		t.Errorf("session userID = %q, want %q", f.sess.authedUserID, user.ID)
	}
}

func TestOAuthLinkFailures(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name     string
		token    string // "" means seed a valid one
		password string
		setup    func(f *oauthFixture, user sqlcdb.User)
		wantCode int
	}{
		{
			name:     "expired token",
			token:    "unknown-token",
			password: testPassword,
			wantCode: http.StatusBadRequest,
		},
		{
			name:     "wrong password",
			password: "wrong-password",
			wantCode: http.StatusBadRequest,
		},
		{
			name:     "rate limited",
			password: testPassword,
			setup: func(f *oauthFixture, _ sqlcdb.User) {
				f.limiter.deny = map[string]bool{ratelimit.BucketLinkAccount: true}
			},
			wantCode: http.StatusTooManyRequests,
		},
		{
			name:     "peek error",
			password: testPassword,
			setup:    func(f *oauthFixture, _ sqlcdb.User) { f.tokens.pendingErr = errors.New("redis down") },
			wantCode: http.StatusInternalServerError,
		},
		{
			name:     "credential lookup error",
			password: testPassword,
			setup:    func(f *oauthFixture, _ sqlcdb.User) { f.store.emailErr = errors.New("db down") },
			wantCode: http.StatusInternalServerError,
		},
		{
			name:     "create account error",
			password: testPassword,
			setup:    func(f *oauthFixture, _ sqlcdb.User) { f.store.accountWriteErr = errors.New("db down") },
			wantCode: http.StatusInternalServerError,
		},
		{
			name:     "establish session error",
			password: testPassword,
			setup:    func(f *oauthFixture, _ sqlcdb.User) { f.sess.authErr = errors.New("redis down") },
			wantCode: http.StatusInternalServerError,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			f := newOAuthFixture(t)
			user := sqlcdb.User{ID: "user-1", Email: "owner@example.com", Password: new(hashPassword(t, testPassword))}
			f.store.add(user)
			token := tc.token
			if token == "" {
				token = seedPendingLink(t, f, user.Email)
			}
			if tc.setup != nil {
				tc.setup(f, user)
			}
			resp := f.api.Post("/auth/link", map[string]any{"token": token, "password": tc.password})
			if resp.Code != tc.wantCode {
				t.Fatalf("status = %d, want %d; body = %s", resp.Code, tc.wantCode, resp.Body.String())
			}
		})
	}
}

// seedPendingLink stores a pending-link token for primaryEmail with the fixture's github identity.
func seedPendingLink(t *testing.T, f *oauthFixture, primaryEmail string) string {
	t.Helper()
	raw, err := f.tokens.CreatePendingLink(t.Context(), pendingLinkFromIdentity(primaryEmail, f.gh.identity))
	if err != nil {
		t.Fatalf("seed pending link: %v", err)
	}
	return raw
}

// assertRedirect asserts a 302 with the exact Location.
func assertRedirect(t *testing.T, resp *httptest.ResponseRecorder, wantLocation string) {
	t.Helper()
	if resp.Code != http.StatusFound {
		t.Fatalf("status = %d, want 302; body = %s", resp.Code, resp.Body.String())
	}
	if got := resp.Header().Get("Location"); got != wantLocation {
		t.Errorf("Location = %q, want %q", got, wantLocation)
	}
}

// verifiedAt sanity: a true flag stamps a recent time, false yields nil.
func TestVerifiedAt(t *testing.T) {
	t.Parallel()
	if got := verifiedAt(false); got != nil {
		t.Errorf("verifiedAt(false) = %v, want nil", got)
	}
	got := verifiedAt(true)
	if got == nil {
		t.Fatal("verifiedAt(true) = nil, want a timestamp")
	}
	if time.Since(*got) > time.Minute {
		t.Errorf("verifiedAt(true) = %v, want ~now", *got)
	}
}
