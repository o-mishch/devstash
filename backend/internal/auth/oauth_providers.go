package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/github"
	"golang.org/x/oauth2/google"
)

// Provider names and the NextAuth account "type" each maps to. GitHub is plain OAuth2;
// Google is OpenID Connect ("oidc") — the same type values the Next PrismaAdapter wrote,
// so a Go-created accounts row is indistinguishable from a first-party one.
const (
	providerGitHub   = "github"
	providerGoogle   = "google"
	accountTypeOAuth = "oauth"
	accountTypeOIDC  = "oidc"
)

// oauthHTTPTimeout bounds the token-exchange and profile-fetch round-trips.
const oauthHTTPTimeout = 10 * time.Second

// GitHub / Google profile + email endpoints (the userinfo the callback normalizes).
const (
	githubUserURL   = "https://api.github.com/user"
	githubEmailsURL = "https://api.github.com/user/emails"
	googleUserURL   = "https://openidconnect.googleapis.com/v1/userinfo"
)

// rawProfile is a provider's userinfo after normalization but before it becomes an
// OAuthIdentity (which adds the provider name, type, and tokens).
type rawProfile struct {
	id            string
	email         string
	emailVerified bool
	name          *string
	image         *string
}

// fetchFunc reads and normalizes a provider's userinfo through an authorized client.
type fetchFunc = func(ctx context.Context, client *http.Client) (rawProfile, error)

// oauthProvider is the production OAuthProvider over golang.org/x/oauth2: a configured
// oauth2.Config plus a per-provider userinfo fetch. It is the one place real provider
// HTTP happens; the handlers depend only on the OAuthProvider interface. fetch is built
// as a closure over the provider's userinfo URLs (githubFetch/googleFetch) so tests can
// point it at an httptest server.
type oauthProvider struct {
	name  string
	typ   string
	cfg   *oauth2.Config
	fetch fetchFunc
	httpc *http.Client
}

// Compile-time assertion that oauthProvider satisfies the consumer's interface.
var _ OAuthProvider = (*oauthProvider)(nil)

// NewGitHubProvider builds the GitHub OAuth provider. redirectURL must equal the
// callback URI registered in the GitHub OAuth app (API_BASE_URL + /auth/oauth/github/callback).
func NewGitHubProvider(clientID, clientSecret, redirectURL string) OAuthProvider {
	return &oauthProvider{
		name: providerGitHub,
		typ:  accountTypeOAuth,
		cfg: &oauth2.Config{
			ClientID:     clientID,
			ClientSecret: clientSecret,
			RedirectURL:  redirectURL,
			Endpoint:     github.Endpoint,
			Scopes:       []string{"read:user", "user:email"},
		},
		fetch: githubFetch(githubUserURL, githubEmailsURL),
		httpc: &http.Client{Timeout: oauthHTTPTimeout},
	}
}

// NewGoogleProvider builds the Google OIDC provider. redirectURL must equal the
// callback URI registered in the Google OAuth client (API_BASE_URL + /auth/oauth/google/callback).
func NewGoogleProvider(clientID, clientSecret, redirectURL string) OAuthProvider {
	return &oauthProvider{
		name: providerGoogle,
		typ:  accountTypeOIDC,
		cfg: &oauth2.Config{
			ClientID:     clientID,
			ClientSecret: clientSecret,
			RedirectURL:  redirectURL,
			Endpoint:     google.Endpoint,
			Scopes:       []string{"openid", "email", "profile"},
		},
		fetch: googleFetch(googleUserURL),
		httpc: &http.Client{Timeout: oauthHTTPTimeout},
	}
}

func (p *oauthProvider) Name() string { return p.name }

// AuthCodeURL builds the provider authorize URL carrying the CSRF state.
func (p *oauthProvider) AuthCodeURL(state string) string {
	return p.cfg.AuthCodeURL(state)
}

// Exchange trades the authorization code for a token, then fetches and normalizes the
// provider's userinfo. The bounded httpc is injected via the context so both the token
// endpoint and the userinfo call honour oauthHTTPTimeout.
func (p *oauthProvider) Exchange(ctx context.Context, code string) (OAuthIdentity, error) {
	ctx = context.WithValue(ctx, oauth2.HTTPClient, p.httpc)
	tok, err := p.cfg.Exchange(ctx, code)
	if err != nil {
		return OAuthIdentity{}, fmt.Errorf("auth: oauth %s exchange: %w", p.name, err)
	}
	raw, err := p.fetch(ctx, p.cfg.Client(ctx, tok))
	if err != nil {
		return OAuthIdentity{}, err
	}
	return OAuthIdentity{
		Provider:          p.name,
		Type:              p.typ,
		ProviderAccountID: raw.id,
		Email:             raw.email,
		EmailVerified:     raw.emailVerified,
		Name:              raw.name,
		Image:             raw.image,
		Tokens:            tokenFields(tok),
	}, nil
}

// githubFetch builds the GitHub userinfo fetch over the given endpoints. It reads GET
// userURL, then falls back to GET emailsURL for the primary verified email when the
// profile's email is private (null). GitHub's profile endpoint doesn't carry a verified
// flag, so the emails endpoint's "verified" is used. (URLs are parameters so tests can
// point them at an httptest server.)
func githubFetch(userURL, emailsURL string) fetchFunc {
	return func(ctx context.Context, client *http.Client) (rawProfile, error) {
		var u struct {
			ID     int64   `json:"id"`
			Name   *string `json:"name"`
			Avatar string  `json:"avatar_url"`
			Email  *string `json:"email"`
		}
		if err := getJSON(ctx, client, userURL, &u); err != nil {
			return rawProfile{}, err
		}

		email, verified := deref(u.Email), u.Email != nil && *u.Email != ""
		if !verified {
			primary, err := fetchGitHubPrimaryEmail(ctx, client, emailsURL)
			if err != nil {
				return rawProfile{}, err
			}
			email, verified = primary.email, primary.verified
		}
		return rawProfile{
			id:            strconv.FormatInt(u.ID, 10),
			email:         email,
			emailVerified: verified,
			name:          u.Name,
			image:         nonEmptyPtr(u.Avatar),
		}, nil
	}
}

// githubEmail is one entry from GET /user/emails.
type githubEmail struct {
	email    string
	verified bool
}

// fetchGitHubPrimaryEmail returns the account's primary email and its verified flag.
// A missing primary yields a zero value (empty email), which the callback treats as
// "no usable email".
func fetchGitHubPrimaryEmail(ctx context.Context, client *http.Client, emailsURL string) (githubEmail, error) {
	var emails []struct {
		Email    string `json:"email"`
		Primary  bool   `json:"primary"`
		Verified bool   `json:"verified"`
	}
	if err := getJSON(ctx, client, emailsURL, &emails); err != nil {
		return githubEmail{}, err
	}
	for e := range slices.Values(emails) {
		if e.Primary {
			return githubEmail{email: e.Email, verified: e.Verified}, nil
		}
	}
	return githubEmail{}, nil
}

// googleFetch builds the Google userinfo fetch over the given endpoint. The OIDC
// userinfo response carries email_verified directly.
func googleFetch(userURL string) fetchFunc {
	return func(ctx context.Context, client *http.Client) (rawProfile, error) {
		var u struct {
			Sub           string  `json:"sub"`
			Email         string  `json:"email"`
			EmailVerified bool    `json:"email_verified"`
			Name          *string `json:"name"`
			Picture       string  `json:"picture"`
		}
		if err := getJSON(ctx, client, userURL, &u); err != nil {
			return rawProfile{}, err
		}
		return rawProfile{
			id:            u.Sub,
			email:         u.Email,
			emailVerified: u.EmailVerified,
			name:          u.Name,
			image:         nonEmptyPtr(u.Picture),
		}, nil
	}
}

// tokenFields extracts the provider token fields persisted on the accounts row. scope
// and id_token are provider "extras" (not first-class oauth2.Token fields); expires_at
// is the Unix expiry when present.
func tokenFields(tok *oauth2.Token) OAuthTokens {
	fields := OAuthTokens{}
	if tok.AccessToken != "" {
		access := tok.AccessToken
		fields.AccessToken = &access
	}
	if tok.RefreshToken != "" {
		refresh := tok.RefreshToken
		fields.RefreshToken = &refresh
	}
	if tok.TokenType != "" {
		typ := tok.TokenType
		fields.TokenType = &typ
	}
	if !tok.Expiry.IsZero() {
		// accounts.expires_at is an int4 column (NextAuth/Prisma parity), and OAuth
		// expiries are Unix seconds that fit int32 until 2038 — the same representation
		// the Next adapter stores.
		exp := int32(tok.Expiry.Unix()) // #nosec G115 -- int4 column; Unix seconds fit until 2038
		fields.ExpiresAt = &exp
	}
	if scope, ok := tok.Extra("scope").(string); ok && scope != "" {
		fields.Scope = &scope
	}
	if idToken, ok := tok.Extra("id_token").(string); ok && idToken != "" {
		fields.IDToken = &idToken
	}
	return fields
}

// getJSON performs an authorized GET (the client injects the bearer token) and decodes
// a JSON response, treating any non-200 as an error.
func getJSON(ctx context.Context, client *http.Client, endpoint string, dst any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return fmt.Errorf("auth: build request %s: %w", endpoint, err)
	}
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("auth: request %s: %w", endpoint, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("auth: request %s: status %d", endpoint, resp.StatusCode)
	}
	if err := json.NewDecoder(resp.Body).Decode(dst); err != nil {
		return fmt.Errorf("auth: decode %s: %w", endpoint, err)
	}
	return nil
}

// nonEmptyPtr returns a pointer to s, or nil when s is empty (a null column value).
func nonEmptyPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
