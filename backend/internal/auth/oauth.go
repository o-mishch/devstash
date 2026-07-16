package auth

import (
	"context"
	"errors"
	"maps"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/jackc/pgx/v5"

	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
	"github.com/o-mishch/devstash/backend/internal/middleware"
	"github.com/o-mishch/devstash/backend/internal/ratelimit"
	"github.com/o-mishch/devstash/backend/internal/session"
)

// OAuthIdentity is the normalized identity a provider resolves after exchanging the
// authorization code — the provider-shape-agnostic view the callback logic works
// against. Type is the account "type" NextAuth would store ("oauth" for GitHub's
// OAuth2, "oidc" for Google's OpenID Connect); the raw provider tokens are carried
// through to the accounts row so a Go-written link matches a first-party one.
type OAuthIdentity struct {
	Provider          string
	Type              string
	ProviderAccountID string
	Email             string
	EmailVerified     bool
	Name              *string
	Image             *string
	Tokens            OAuthTokens
}

// OAuthTokens are the provider token fields persisted on the accounts row.
type OAuthTokens struct {
	AccessToken  *string
	RefreshToken *string
	ExpiresAt    *int32
	TokenType    *string
	Scope        *string
	IDToken      *string
}

// OAuthProvider is one configured OAuth provider. It builds the authorize URL and
// exchanges an authorization code for a normalized identity. Implemented by
// *oauthProvider (oauth_providers.go) over golang.org/x/oauth2 in production and by a
// fake in tests — so the callback's branching logic is tested without real HTTP or
// real provider credentials. It is the single external-service seam of the OAuth flow.
type OAuthProvider interface {
	Name() string
	AuthCodeURL(state string) string
	Exchange(ctx context.Context, code string) (OAuthIdentity, error)
}

// oauthRedirect is the shared 302 output for every OAuth operation (start, callback,
// link). Only a Location header is set; the session cookie, when a session is
// established, is written by scs.LoadAndSave, not here.
type oauthRedirect struct {
	Location string `header:"Location"`
}

// SPA redirect targets the callback 302s to. The SPA owns the actual pages; these are
// just where the browser lands after the provider round-trip completes.
const (
	oauthSuccessPath = "/dashboard"
	oauthSignInPath  = "/sign-in"
	oauthLinkPath    = "/link-account"
)

// OAuth error codes surfaced to the SPA as ?error=<code> on the sign-in page. Kept
// coarse on purpose — the browser sees only the class of failure, never the detail
// (which is logged), so a callback never leaks whether an email exists or why exchange failed.
const (
	oauthErrDenied   = "oauth_denied"   // user declined at the provider
	oauthErrState    = "oauth_state"    // missing / expired / mismatched state (CSRF guard)
	oauthErrExchange = "oauth_exchange" // code exchange or profile fetch failed
	oauthErrNoEmail  = "oauth_no_email" // provider returned no usable email
	oauthErrServer   = "oauth_server"   // internal error (DB, session, tokens)
)

// registerOAuth wires the OAuth surface: start + callback per configured provider,
// plus the single password-confirm link endpoint. Providers absent from the map
// (credentials unset) register nothing, so a deploy without OAuth secrets simply has
// no OAuth routes rather than failing to boot.
func registerOAuth(api huma.API, s *Service) {
	// Sorted by name so the emitted OpenAPI operation order is deterministic
	// regardless of map iteration order.
	for name := range slices.Values(slices.Sorted(maps.Keys(s.Providers))) {
		provider := s.Providers[name]
		registerOAuthStart(api, s, provider)
		registerOAuthCallback(api, s, provider)
	}
	if len(s.Providers) > 0 {
		registerOAuthLink(api, s)
	}
}

// oauthStartInput carries an optional post-auth redirect target; the provider is fixed by
// the route. Redirect is untrusted (this endpoint is directly reachable, not only via the
// SPA), so it is sanitized server-side in the handler — an unsafe value is dropped in favor
// of the default landing, never rejected, so a crafted URL can't break the sign-in entry.
type oauthStartInput struct {
	Redirect string `doc:"Relative path to return to after a successful sign-in" query:"redirect"`
}

// registerOAuthStart wires GET /auth/oauth/{provider}/start — mint a single-use state
// token and 302 to the provider's authorize URL. This replaces the Next app's
// server-action sign-in trigger: the SPA navigates the browser straight here.
func registerOAuthStart(api huma.API, s *Service, provider OAuthProvider) {
	name := provider.Name()
	huma.Register(api, huma.Operation{
		OperationID:   "auth-oauth-" + name + "-start",
		Method:        http.MethodGet,
		Path:          "/auth/oauth/" + name + "/start",
		Summary:       "Begin " + name + " OAuth sign-in",
		Tags:          []string{tagAuth},
		DefaultStatus: http.StatusFound,
	}, func(ctx context.Context, in *oauthStartInput) (*oauthRedirect, error) {
		state, err := s.Tokens.CreateOAuthState(ctx, OAuthState{
			Provider: name,
			Redirect: sanitizeOAuthRedirect(in.Redirect),
		})
		if err != nil {
			s.Logger.ErrorContext(ctx, "oauth: create state failed", "provider", name, "err", err)
			return nil, huma.Error500InternalServerError(genericErrorMessage)
		}
		return &oauthRedirect{Location: provider.AuthCodeURL(state)}, nil
	})
}

// oauthCallbackInput is the provider's redirect back. code/state are absent on a
// user-denied callback (only `error` is set), so none are marked required — the
// handler classifies the outcome instead of letting Huma 422 the browser.
type oauthCallbackInput struct {
	Code  string `query:"code"`
	State string `query:"state"`
	Error string `query:"error"`
}

// registerOAuthCallback wires GET /auth/oauth/{provider}/callback. Every outcome is a
// 302: on success to the SPA dashboard (session cookie set), on a detected conflict to
// the link page, and on any failure to the sign-in page with a coarse ?error code.
func registerOAuthCallback(api huma.API, s *Service, provider OAuthProvider) {
	name := provider.Name()
	huma.Register(api, huma.Operation{
		OperationID:   "auth-oauth-" + name + "-callback",
		Method:        http.MethodGet,
		Path:          "/auth/oauth/" + name + "/callback",
		Summary:       "Complete " + name + " OAuth sign-in",
		Tags:          []string{tagAuth},
		DefaultStatus: http.StatusFound,
	}, func(ctx context.Context, in *oauthCallbackInput) (*oauthRedirect, error) {
		return s.handleOAuthCallback(ctx, provider, in), nil
	})
}

// handleOAuthCallback runs the callback state machine and always returns a redirect
// (never a Huma error) — the caller is a browser mid-redirect, so even internal
// failures land on the SPA sign-in page rather than a raw JSON error.
func (s *Service) handleOAuthCallback(
	ctx context.Context,
	provider OAuthProvider,
	in *oauthCallbackInput,
) *oauthRedirect {
	name := provider.Name()
	if in.Error != "" {
		s.Logger.InfoContext(ctx, "oauth: provider returned error", "provider", name, "error", in.Error)
		return s.oauthErrorRedirect(oauthErrDenied)
	}

	// Validate + burn the state (single-use). A missing/expired/mismatched state is the
	// CSRF guard firing — reject without touching the provider.
	state, ok, err := s.Tokens.ConsumeOAuthState(ctx, in.State)
	if err != nil {
		s.Logger.ErrorContext(ctx, "oauth: consume state failed", "provider", name, "err", err)
		return s.oauthErrorRedirect(oauthErrServer)
	}
	if !ok || state.Provider != name || in.Code == "" {
		s.Logger.WarnContext(ctx, "oauth: invalid state or missing code", "provider", name, "stateOK", ok)
		return s.oauthErrorRedirect(oauthErrState)
	}

	identity, err := provider.Exchange(ctx, in.Code)
	if err != nil {
		s.Logger.ErrorContext(ctx, "oauth: code exchange failed", "provider", name, "err", err)
		return s.oauthErrorRedirect(oauthErrExchange)
	}
	if identity.Email == "" {
		s.Logger.WarnContext(ctx, "oauth: provider returned no email", "provider", name)
		return s.oauthErrorRedirect(oauthErrNoEmail)
	}
	identity.Email = normalizeEmail(identity.Email)

	return s.resolveOAuthIdentity(ctx, identity, state.Redirect)
}

// resolveOAuthIdentity routes a resolved identity to one of three outcomes: a returning
// user (this exact provider account already exists → sign in), an email conflict (an
// existing account owns the address but hasn't linked this provider → password-confirm
// link flow), or a brand-new user (create user + account → sign in).
//
// NOTE(deferred): the Next app also has a link-INTENT path here (a signed-in user who
// clicked "Add account" on their profile carries a cookie-borne intent). That flow —
// minting the intent and its cookie — is profile/F-track surface with no SPA yet, so it
// is deliberately not wired in this slice; the callback only handles the two anonymous
// outcomes plus new-user creation.
func (s *Service) resolveOAuthIdentity(ctx context.Context, identity OAuthIdentity, redirect string) *oauthRedirect {
	acct, err := s.Users.GetProviderAccount(ctx, sqlcdb.GetProviderAccountParams{
		Provider:          identity.Provider,
		ProviderAccountId: identity.ProviderAccountID,
	})
	switch {
	case err == nil:
		return s.oauthReturningUser(ctx, acct, identity, redirect)
	case errors.Is(err, pgx.ErrNoRows):
		// fall through to conflict / new-user resolution
	default:
		s.Logger.ErrorContext(ctx, "oauth: provider-account lookup failed", "provider", identity.Provider, "err", err)
		return s.oauthErrorRedirect(oauthErrServer)
	}

	conflict, err := s.Users.GetUserWithOAuthConflict(ctx, sqlcdb.GetUserWithOAuthConflictParams{
		Email:    identity.Email,
		Provider: identity.Provider,
	})
	switch {
	case err == nil:
		return s.oauthConflict(ctx, conflict, identity, redirect)
	case errors.Is(err, pgx.ErrNoRows):
		return s.oauthNewUser(ctx, identity, redirect)
	default:
		s.Logger.ErrorContext(ctx, "oauth: conflict lookup failed", "provider", identity.Provider, "err", err)
		return s.oauthErrorRedirect(oauthErrServer)
	}
}

// oauthReturningUser signs in the owner of an already-linked provider account and
// best-effort backfills the stored provider email if it was missing.
func (s *Service) oauthReturningUser(
	ctx context.Context,
	acct sqlcdb.Account,
	identity OAuthIdentity,
	redirect string,
) *oauthRedirect {
	if acct.Email == nil && identity.EmailVerified {
		if err := s.Users.BackfillOAuthAccountEmail(ctx, sqlcdb.BackfillOAuthAccountEmailParams{
			Provider:          identity.Provider,
			ProviderAccountId: identity.ProviderAccountID,
			Email:             &identity.Email,
		}); err != nil {
			// Non-fatal: the sign-in still succeeds, the email just stays null for now.
			s.Logger.WarnContext(ctx, "oauth: account email backfill failed", "provider", identity.Provider, "err", err)
		}
	}
	if err := s.establishOAuthSession(ctx, acct.UserId); err != nil {
		s.Logger.ErrorContext(ctx, "oauth: establish session failed", "userID", acct.UserId, "err", err)
		return s.oauthErrorRedirect(oauthErrServer)
	}
	s.Logger.InfoContext(ctx, "oauth sign-in (returning)", "provider", identity.Provider, "userID", acct.UserId)
	return s.appRedirect(landingPath(redirect), nil)
}

// oauthConflict stashes the identity in a pending-link token and sends the browser to
// the SPA link page, where the user proves ownership with their password (POST /auth/link).
func (s *Service) oauthConflict(
	ctx context.Context,
	conflict sqlcdb.GetUserWithOAuthConflictRow,
	identity OAuthIdentity,
	redirect string,
) *oauthRedirect {
	token, err := s.Tokens.CreatePendingLink(ctx, pendingLinkFromIdentity(conflict.Email, identity))
	if err != nil {
		s.Logger.ErrorContext(ctx, "oauth: create pending link failed", "provider", identity.Provider, "err", err)
		return s.oauthErrorRedirect(oauthErrServer)
	}
	// Carry the redirect through the link page too, so a deep-linked sign-in that hits an
	// account conflict still lands where it started once the user confirms their password.
	query := url.Values{"token": {token}}
	if redirect != "" {
		query.Set("redirect", redirect)
	}
	s.Logger.InfoContext(ctx, "oauth conflict — routing to link", "provider", identity.Provider, "userID", conflict.ID)
	return s.appRedirect(oauthLinkPath, query)
}

// oauthNewUser creates the user and its linked account for a first-time identity, then
// signs in. User and account are two writes (parity with the Next adapter's
// createUser-then-linkAccount): a failure between them leaves a userless-account-free
// row that a later sign-in reconciles via the conflict path, never a partial account.
func (s *Service) oauthNewUser(ctx context.Context, identity OAuthIdentity, redirect string) *oauthRedirect {
	user, err := s.Users.CreateOAuthUser(ctx, sqlcdb.CreateOAuthUserParams{
		ID:            s.IDs(),
		Email:         identity.Email,
		Name:          identity.Name,
		Image:         identity.Image,
		EmailVerified: verifiedAt(identity.EmailVerified),
	})
	if err != nil {
		// A unique violation means a concurrent request created the user first; the
		// simplest correct recovery is to bounce through the flow again (the second
		// attempt takes the returning-user or conflict branch).
		s.Logger.ErrorContext(ctx, "oauth: create user failed", "provider", identity.Provider, "err", err)
		return s.oauthErrorRedirect(oauthErrServer)
	}
	if err := s.createOAuthAccount(ctx, user.ID, identity); err != nil {
		s.Logger.ErrorContext(
			ctx,
			"oauth: create account failed",
			"userID",
			user.ID,
			"provider",
			identity.Provider,
			"err",
			err,
		)
		return s.oauthErrorRedirect(oauthErrServer)
	}
	if err := s.establishOAuthSession(ctx, user.ID); err != nil {
		s.Logger.ErrorContext(ctx, "oauth: establish session failed", "userID", user.ID, "err", err)
		return s.oauthErrorRedirect(oauthErrServer)
	}
	s.Logger.InfoContext(ctx, "oauth sign-in (new user)", "provider", identity.Provider, "userID", user.ID)
	return s.appRedirect(landingPath(redirect), nil)
}

// oauthLinkInput is the password-confirm body for POST /auth/link.
type oauthLinkInput struct {
	Body struct {
		Token    string `doc:"Pending-link token from the callback redirect" json:"token"    required:"true"`
		Password string `doc:"Account password"                              json:"password" maxLength:"128" minLength:"1" required:"true"`
	}
}

// registerOAuthLink wires POST /auth/link — the confirm step of a conflict link. The
// user proves ownership of the account behind the pending-link token with their
// password; on success the account is linked and a session is established (204 + cookie).
// Parity: linkAccountAction.
func registerOAuthLink(api huma.API, s *Service) {
	huma.Register(api, huma.Operation{
		OperationID:   "auth-oauth-link",
		Method:        http.MethodPost,
		Path:          "/auth/link",
		Summary:       "Confirm and link a pending OAuth account with a password",
		Tags:          []string{tagAuth},
		DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, in *oauthLinkInput) (*noContent, error) {
		ip := middleware.RemoteIP(ctx)
		if err := s.enforceLimit(ctx, ratelimit.BucketLinkAccount, ip); err != nil {
			return nil, err
		}

		link, ok, err := s.Tokens.PeekPendingLink(ctx, in.Body.Token)
		if err != nil {
			s.Logger.ErrorContext(ctx, "link: peek pending link failed", "err", err)
			return nil, huma.Error500InternalServerError(genericErrorMessage)
		}
		if !ok {
			return nil, huma.Error400BadRequest("This link has expired. Please try signing in again.")
		}

		match, ok, err := s.validateCredential(ctx, normalizeEmail(link.Email), strings.TrimSpace(in.Body.Password))
		if err != nil {
			s.Logger.ErrorContext(ctx, "link: credential lookup failed", "err", err)
			return nil, huma.Error500InternalServerError(genericErrorMessage)
		}
		if !ok {
			return nil, huma.Error400BadRequest("Incorrect password or account not found.")
		}

		if err := s.linkPendingAccount(ctx, match.user.ID, link); err != nil {
			s.Logger.ErrorContext(ctx, "link: create account failed", "userID", match.user.ID, "err", err)
			return nil, huma.Error500InternalServerError(genericErrorMessage)
		}

		// Consume only after the link succeeds — a wrong password above left the token
		// armed for a retry. A stale delete here is idempotent.
		if err := s.Tokens.ConsumePendingLink(ctx, in.Body.Token); err != nil {
			s.Logger.WarnContext(ctx, "link: consume pending link failed", "err", err)
		}
		if err := s.Email.SendSecurityNotification(ctx, match.user.Email, SecurityMethodLinked); err != nil {
			s.Logger.ErrorContext(ctx, "link: notify failed", "err", err)
		}

		fingerprint := session.PasswordFingerprint(deref(match.user.Password))
		if err := s.Sessions.Authenticate(ctx, match.user.ID, fingerprint); err != nil {
			s.Logger.ErrorContext(ctx, "link: establish session failed", "userID", match.user.ID, "err", err)
			return nil, huma.Error500InternalServerError(genericErrorMessage)
		}
		s.Logger.InfoContext(ctx, "oauth account linked", "userID", match.user.ID, "provider", link.Provider)
		return &noContent{}, nil
	})
}

// linkPendingAccount links the pending account to userID, idempotently: if the exact
// (provider, providerAccountId) is already linked it is a no-op, and a concurrent
// double-link that trips the unique index is treated as success. Parity: linkPendingAccount.
func (s *Service) linkPendingAccount(ctx context.Context, userID string, link PendingLink) error {
	_, err := s.Users.GetProviderAccount(ctx, sqlcdb.GetProviderAccountParams{
		Provider:          link.Provider,
		ProviderAccountId: link.ProviderAccountID,
	})
	if err == nil {
		return nil // already linked (to this user or another — the confirm can't move it)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	return s.createAccountRow(ctx, sqlcdb.CreateAccountParams{
		ID:                s.IDs(),
		UserId:            userID,
		Type:              link.Type,
		Provider:          link.Provider,
		ProviderAccountId: link.ProviderAccountID,
		AccessToken:       link.AccessToken,
		RefreshToken:      link.RefreshToken,
		ExpiresAt:         link.ExpiresAt,
		TokenType:         link.TokenType,
		Scope:             link.Scope,
		IDToken:           link.IDToken,
		SessionState:      link.SessionState,
		Email:             link.ProviderEmail,
	})
}

// createOAuthAccount writes the accounts row for a freshly created OAuth user.
func (s *Service) createOAuthAccount(ctx context.Context, userID string, identity OAuthIdentity) error {
	return s.createAccountRow(ctx, sqlcdb.CreateAccountParams{
		ID:                s.IDs(),
		UserId:            userID,
		Type:              identity.Type,
		Provider:          identity.Provider,
		ProviderAccountId: identity.ProviderAccountID,
		AccessToken:       identity.Tokens.AccessToken,
		RefreshToken:      identity.Tokens.RefreshToken,
		ExpiresAt:         identity.Tokens.ExpiresAt,
		TokenType:         identity.Tokens.TokenType,
		Scope:             identity.Tokens.Scope,
		IDToken:           identity.Tokens.IDToken,
		SessionState:      nil,
		Email:             &identity.Email,
	})
}

// createAccountRow inserts an accounts row, folding a unique-violation race into
// success (a concurrent request already created the identical link).
func (s *Service) createAccountRow(ctx context.Context, arg sqlcdb.CreateAccountParams) error {
	if err := s.Users.CreateAccount(ctx, arg); err != nil {
		if isUniqueViolation(err) {
			s.Logger.InfoContext(ctx, "oauth: account link race — already created", "provider", arg.Provider)
			return nil
		}
		return err
	}
	return nil
}

// establishOAuthSession re-resolves the user to snapshot the current password
// fingerprint (so the session survives the middleware's rotation check), then issues
// the session. OAuth users usually have no password (fingerprint ""), but one may have
// added a credential login, so the live value is read rather than assumed.
func (s *Service) establishOAuthSession(ctx context.Context, userID string) error {
	user, err := s.Users.GetUserByID(ctx, userID)
	if err != nil {
		return err
	}
	return s.Sessions.Authenticate(ctx, userID, session.PasswordFingerprint(deref(user.Password)))
}

// pendingLinkFromIdentity builds the pending-link payload stored on a conflict: the
// DevStash primary email (the confirm step's password target) plus the provider
// identity and tokens to write once ownership is proven.
func pendingLinkFromIdentity(primaryEmail string, identity OAuthIdentity) PendingLink {
	return PendingLink{
		Email:             primaryEmail,
		ProviderEmail:     &identity.Email,
		Provider:          identity.Provider,
		ProviderAccountID: identity.ProviderAccountID,
		Type:              identity.Type,
		AccessToken:       identity.Tokens.AccessToken,
		RefreshToken:      identity.Tokens.RefreshToken,
		ExpiresAt:         identity.Tokens.ExpiresAt,
		TokenType:         identity.Tokens.TokenType,
		Scope:             identity.Tokens.Scope,
		IDToken:           identity.Tokens.IDToken,
	}
}

// maxRedirectLen bounds a stored redirect target so a crafted URL can't bloat the state blob.
const maxRedirectLen = 2048

// isOAuthAuthLoopPath reports whether path (normalized) is an SPA auth route that must never
// be a post-auth landing target — a signed-in user bounced back onto one just re-triggers its
// "already signed in" guard. Mirror of the SPA sanitizeRelative auth-loop set
// (web/src/auth/redirect.ts).
func isOAuthAuthLoopPath(path string) bool {
	switch strings.ToLower(strings.TrimRight(path, "/")) {
	case "/sign-in", "/register", "/forgot-password", "/reset-password", "/verify-email", "/link-account":
		return true
	default:
		return false
	}
}

// landingPath is the SPA path a successful OAuth sign-in lands on: the caller's sanitized
// redirect target when one survived the round-trip, else the default dashboard.
func landingPath(redirect string) string {
	if redirect != "" {
		return redirect
	}
	return oauthSuccessPath
}

// sanitizeOAuthRedirect validates a caller-supplied post-auth redirect and returns a safe
// same-origin relative path, or "" to mean "use the default landing". The /start endpoint is
// directly reachable, so the param is untrusted — this is the open-redirect guard required by
// security-principles.md, mirroring the SPA's sanitizeRelative (web/src/auth/redirect.ts). The
// callback only ever builds `SPAOrigin + path`, so the sole authority-injection risk is a value
// that doesn't begin with a single "/"; the remaining checks reject header-injection (control
// chars), backslash/encoded-slash tricks, over-long input, and auth-loop targets.
func sanitizeOAuthRedirect(raw string) string {
	if raw == "" || len(raw) > maxRedirectLen {
		return ""
	}
	// Must be a plain absolute-path reference, not protocol-relative or a backslash escape.
	if !strings.HasPrefix(raw, "/") || strings.HasPrefix(raw, "//") || strings.HasPrefix(raw, "/\\") {
		return ""
	}
	if strings.Contains(raw, "\\") {
		return ""
	}
	// Control chars (incl. NUL/tab/newlines and DEL) would enable Location-header injection.
	if strings.IndexFunc(raw, func(r rune) bool { return r < 0x20 || r == 0x7f }) >= 0 {
		return ""
	}
	lower := strings.ToLower(raw)
	if strings.Contains(lower, "%2f%2f") || strings.Contains(lower, "%5c") {
		return ""
	}
	// Re-assert via the parser: reject anything that carries a scheme or host (a protocol-
	// relative value that slipped the string guards would surface here as a non-empty Host).
	u, err := url.Parse(raw)
	if err != nil || u.IsAbs() || u.Host != "" {
		return ""
	}
	if isOAuthAuthLoopPath(u.Path) {
		return ""
	}
	return raw
}

// appRedirect builds a 302 to a SPA path with optional query.
func (s *Service) appRedirect(path string, query url.Values) *oauthRedirect {
	target := strings.TrimRight(s.Cfg.SPAOrigin, "/") + path
	if len(query) > 0 {
		target += "?" + query.Encode()
	}
	return &oauthRedirect{Location: target}
}

// oauthErrorRedirect sends the browser to the SPA sign-in page with a coarse error code.
func (s *Service) oauthErrorRedirect(code string) *oauthRedirect {
	return s.appRedirect(oauthSignInPath, url.Values{"error": {code}})
}

// verifiedAt returns a pointer to the current time when verified, else nil — the
// emailVerified column value for a new OAuth user (set only when the provider asserts
// the email is verified).
func verifiedAt(verified bool) *time.Time {
	if !verified {
		return nil
	}
	now := time.Now()
	return &now
}

// deref returns the pointed-to string, or "" for a nil pointer.
func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
