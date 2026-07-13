package auth

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"golang.org/x/oauth2"
)

// oauthTestServer stands up a fake provider: a token endpoint plus the userinfo
// handlers the caller registers. tokenResponse is the JSON the /token endpoint returns.
func oauthTestServer(t *testing.T, tokenResponse string, handlers map[string]string) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/token", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, tokenResponse)
	})
	for path, body := range handlers {
		mux.HandleFunc(path, func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, body)
		})
	}
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)
	return ts
}

// newTestProvider wires an oauthProvider to the test server's token endpoint and the
// given fetch, using the server's client so requests reach it.
func newTestProvider(name, typ string, ts *httptest.Server, fetch fetchFunc) *oauthProvider {
	return &oauthProvider{
		name: name,
		typ:  typ,
		cfg: &oauth2.Config{
			ClientID:     "client-id",
			ClientSecret: "client-secret",
			RedirectURL:  "https://api.devstash.one/auth/oauth/" + name + "/callback",
			Endpoint:     oauth2.Endpoint{AuthURL: ts.URL + "/auth", TokenURL: ts.URL + "/token"},
		},
		fetch: fetch,
		httpc: ts.Client(),
	}
}

const githubToken = `{"access_token":"gh-access","token_type":"bearer","expires_in":3600,"scope":"read:user,user:email","id_token":"gh-id"}`

func TestGitHubExchangePublicEmail(t *testing.T) {
	t.Parallel()
	ts := oauthTestServer(t, githubToken, map[string]string{
		"/user": `{"id":12345,"name":"Octo Cat","avatar_url":"https://avatars/1","email":"octo@example.com"}`,
	})
	p := newTestProvider(providerGitHub, accountTypeOAuth, ts, githubFetch(ts.URL+"/user", ts.URL+"/emails"))

	id, err := p.Exchange(t.Context(), "code")
	if err != nil {
		t.Fatalf("exchange: %v", err)
	}
	if id.ProviderAccountID != "12345" {
		t.Errorf("providerAccountID = %q, want 12345", id.ProviderAccountID)
	}
	if id.Email != "octo@example.com" || !id.EmailVerified {
		t.Errorf("email = %q verified = %v, want octo@example.com true", id.Email, id.EmailVerified)
	}
	if id.Name == nil || *id.Name != "Octo Cat" {
		t.Errorf("name = %v, want Octo Cat", id.Name)
	}
	if id.Image == nil || *id.Image != "https://avatars/1" {
		t.Errorf("image = %v, want the avatar url", id.Image)
	}
	if id.Tokens.AccessToken == nil || *id.Tokens.AccessToken != "gh-access" {
		t.Errorf("access token = %v, want gh-access", id.Tokens.AccessToken)
	}
	if id.Tokens.Scope == nil || *id.Tokens.Scope != "read:user,user:email" {
		t.Errorf("scope = %v, want the granted scopes", id.Tokens.Scope)
	}
	if id.Tokens.IDToken == nil || *id.Tokens.IDToken != "gh-id" {
		t.Errorf("id token = %v, want gh-id", id.Tokens.IDToken)
	}
	if id.Tokens.ExpiresAt == nil {
		t.Error("expires_at = nil, want a value from expires_in")
	}
}

func TestGitHubExchangePrivateEmailFallback(t *testing.T) {
	t.Parallel()
	ts := oauthTestServer(t, githubToken, map[string]string{
		"/user":   `{"id":7,"name":"Priv","avatar_url":"","email":null}`,
		"/emails": `[{"email":"secondary@example.com","primary":false,"verified":true},{"email":"primary@example.com","primary":true,"verified":true}]`,
	})
	p := newTestProvider(providerGitHub, accountTypeOAuth, ts, githubFetch(ts.URL+"/user", ts.URL+"/emails"))

	id, err := p.Exchange(t.Context(), "code")
	if err != nil {
		t.Fatalf("exchange: %v", err)
	}
	if id.Email != "primary@example.com" || !id.EmailVerified {
		t.Errorf("email = %q verified = %v, want primary@example.com true", id.Email, id.EmailVerified)
	}
	// Empty avatar → nil image (null column).
	if id.Image != nil {
		t.Errorf("image = %v, want nil for empty avatar", id.Image)
	}
}

func TestGitHubExchangeNoPrimaryEmail(t *testing.T) {
	t.Parallel()
	ts := oauthTestServer(t, githubToken, map[string]string{
		"/user":   `{"id":9,"email":null}`,
		"/emails": `[{"email":"only@example.com","primary":false,"verified":true}]`,
	})
	p := newTestProvider(providerGitHub, accountTypeOAuth, ts, githubFetch(ts.URL+"/user", ts.URL+"/emails"))

	id, err := p.Exchange(t.Context(), "code")
	if err != nil {
		t.Fatalf("exchange: %v", err)
	}
	// No primary → empty email (the callback then rejects with oauth_no_email).
	if id.Email != "" {
		t.Errorf("email = %q, want empty when no primary", id.Email)
	}
}

func TestGoogleExchange(t *testing.T) {
	t.Parallel()
	googleToken := `{"access_token":"g-access","token_type":"bearer","expires_in":3600}`
	ts := oauthTestServer(t, googleToken, map[string]string{
		"/userinfo": `{"sub":"google-sub-1","email":"user@gmail.com","email_verified":true,"name":"G User","picture":"https://pic/1"}`,
	})
	p := newTestProvider(providerGoogle, accountTypeOIDC, ts, googleFetch(ts.URL+"/userinfo"))

	id, err := p.Exchange(t.Context(), "code")
	if err != nil {
		t.Fatalf("exchange: %v", err)
	}
	if id.ProviderAccountID != "google-sub-1" {
		t.Errorf("providerAccountID = %q, want google-sub-1", id.ProviderAccountID)
	}
	if id.Email != "user@gmail.com" || !id.EmailVerified {
		t.Errorf("email = %q verified = %v, want user@gmail.com true", id.Email, id.EmailVerified)
	}
	if id.Type != accountTypeOIDC {
		t.Errorf("type = %q, want oidc", id.Type)
	}
	// Google response has no scope/id_token here → nil.
	if id.Tokens.Scope != nil || id.Tokens.IDToken != nil {
		t.Errorf("scope/id_token = %v/%v, want nil", id.Tokens.Scope, id.Tokens.IDToken)
	}
}

func TestExchangeTokenEndpointError(t *testing.T) {
	t.Parallel()
	// A 400 from the token endpoint fails the exchange before any userinfo call.
	mux := http.NewServeMux()
	mux.HandleFunc("/token", func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "bad_verification_code", http.StatusBadRequest)
	})
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)
	p := newTestProvider(providerGitHub, accountTypeOAuth, ts, githubFetch(ts.URL+"/user", ts.URL+"/emails"))

	if _, err := p.Exchange(t.Context(), "code"); err == nil {
		t.Fatal("exchange error = nil, want a token-endpoint error")
	}
}

func TestExchangeUserinfoError(t *testing.T) {
	t.Parallel()
	ts := oauthTestServer(t, githubToken, nil) // no /user handler → 404
	p := newTestProvider(providerGitHub, accountTypeOAuth, ts, githubFetch(ts.URL+"/user", ts.URL+"/emails"))

	if _, err := p.Exchange(t.Context(), "code"); err == nil {
		t.Fatal("exchange error = nil, want a userinfo non-200 error")
	}
}

func TestGetJSONDecodeError(t *testing.T) {
	t.Parallel()
	mux := http.NewServeMux()
	mux.HandleFunc("/bad", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, "{not json")
	})
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)

	var dst map[string]any
	if err := getJSON(t.Context(), ts.Client(), ts.URL+"/bad", &dst); err == nil {
		t.Fatal("getJSON error = nil, want a decode error")
	}
}

func TestConstructorsAndAuthCodeURL(t *testing.T) {
	t.Parallel()
	gh := NewGitHubProvider("gh-id", "gh-secret", "https://api/callback")
	if gh.Name() != providerGitHub {
		t.Errorf("github name = %q, want github", gh.Name())
	}
	authURL := gh.AuthCodeURL("state-xyz")
	if !strings.Contains(authURL, "state-xyz") || !strings.Contains(authURL, "gh-id") {
		t.Errorf("authURL = %q, want it to carry state and client id", authURL)
	}

	google := NewGoogleProvider("g-id", "g-secret", "https://api/callback")
	if google.Name() != providerGoogle {
		t.Errorf("google name = %q, want google", google.Name())
	}
}

func TestTokenFields(t *testing.T) {
	t.Parallel()
	// Full token: every field populated.
	full := (&oauth2.Token{
		AccessToken:  "access",
		TokenType:    "bearer",
		RefreshToken: "refresh",
		Expiry:       time.Unix(1_800_000_000, 0),
	}).WithExtra(map[string]any{"scope": "read:user", "id_token": "id-tok"})
	got := tokenFields(full)
	if got.AccessToken == nil || *got.AccessToken != "access" {
		t.Errorf("access = %v", got.AccessToken)
	}
	if got.RefreshToken == nil || *got.RefreshToken != "refresh" {
		t.Errorf("refresh = %v", got.RefreshToken)
	}
	if got.TokenType == nil || *got.TokenType != "bearer" {
		t.Errorf("tokenType = %v", got.TokenType)
	}
	if got.ExpiresAt == nil || *got.ExpiresAt != int32(time.Unix(1_800_000_000, 0).Unix()) {
		t.Errorf("expiresAt = %v", got.ExpiresAt)
	}
	if got.Scope == nil || *got.Scope != "read:user" {
		t.Errorf("scope = %v", got.Scope)
	}
	if got.IDToken == nil || *got.IDToken != "id-tok" {
		t.Errorf("idToken = %v", got.IDToken)
	}

	// Empty token: everything nil (no expiry, no extras).
	empty := tokenFields(&oauth2.Token{})
	if empty.AccessToken != nil || empty.RefreshToken != nil || empty.TokenType != nil ||
		empty.ExpiresAt != nil || empty.Scope != nil || empty.IDToken != nil {
		t.Errorf("empty token fields = %+v, want all nil", empty)
	}
}
