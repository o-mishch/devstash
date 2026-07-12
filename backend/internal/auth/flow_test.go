package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humago"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/redis/go-redis/v9"

	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
	"github.com/o-mishch/devstash/backend/internal/middleware"
	"github.com/o-mishch/devstash/backend/internal/session"
)

// flowFixture wires the real auth stack (scs session over miniredis + the session
// middleware + all auth ops) so the cookie round-trip of login -> session -> logout
// is exercised end to end, the way the router assembles it in production.
type flowFixture struct {
	server *httptest.Server
	client *http.Client
	store  *fakeUserStore
}

func newFlowFixture(t *testing.T, user sqlcdb.User) *flowFixture {
	t.Helper()

	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	sm := session.New(rdb, session.Config{Lifetime: session.MaxAge, IdleTimeout: session.IdleTimeout})
	store := newFakeUserStore()
	store.add(user)

	deps := Deps{Users: store, Sessions: sm, Limiter: &fakeLimiter{}, Logger: discardLogger()}

	mux := http.NewServeMux()
	api := humago.New(mux, huma.DefaultConfig("test", "1.0.0"))
	api.UseMiddleware(middleware.RequireSession(api, sm, store, discardLogger()))
	Register(api, deps)

	srv := httptest.NewServer(sm.LoadAndSave(mux))
	t.Cleanup(srv.Close)

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("cookiejar: %v", err)
	}
	return &flowFixture{server: srv, client: &http.Client{Jar: jar}, store: store}
}

func (f *flowFixture) do(t *testing.T, method, path, body string) *http.Response {
	t.Helper()
	var rdr *strings.Reader
	if body == "" {
		rdr = strings.NewReader("")
	} else {
		rdr = strings.NewReader(body)
	}
	req, err := http.NewRequestWithContext(context.Background(), method, f.server.URL+path, rdr)
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := f.client.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	return resp
}

func TestAuthFlowLoginSessionLogout(t *testing.T) {
	t.Parallel()
	user := sqlcdb.User{
		ID:            "user-1",
		Email:         "user@example.com",
		Name:          new("Ada"),
		Password:      new(hashPassword(t, testPassword)),
		EmailVerified: new(time.Unix(1_700_000_000, 0)),
		IsPro:         true,
	}
	f := newFlowFixture(t, user)

	// Anonymous session probe is rejected.
	resp := f.do(t, http.MethodGet, "/auth/session", "")
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("anonymous GET /auth/session = %d, want 401", resp.StatusCode)
	}
	_ = resp.Body.Close()

	// Log in — sets the session cookie in the jar.
	resp = f.do(t, http.MethodPost, "/auth/login", `{"email":"user@example.com","password":"`+testPassword+`"}`)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("POST /auth/login = %d, want 204", resp.StatusCode)
	}
	_ = resp.Body.Close()

	// The authenticated probe returns the user.
	resp = f.do(t, http.MethodGet, "/auth/session", "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("authenticated GET /auth/session = %d, want 200", resp.StatusCode)
	}
	var got struct {
		User struct {
			ID    string `json:"id"`
			Email string `json:"email"`
			IsPro bool   `json:"isPro"`
		} `json:"user"`
		Expires time.Time `json:"expires"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode session: %v", err)
	}
	_ = resp.Body.Close()
	if got.User.ID != user.ID || got.User.Email != user.Email || !got.User.IsPro {
		t.Errorf("session user = %+v, want id/email/isPro of %q", got.User, user.ID)
	}
	if got.Expires.IsZero() {
		t.Error("session expires is zero, want a deadline")
	}

	// Log out revokes the session.
	resp = f.do(t, http.MethodPost, "/auth/logout", "")
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("POST /auth/logout = %d, want 204", resp.StatusCode)
	}
	_ = resp.Body.Close()

	// The probe is rejected again after logout.
	resp = f.do(t, http.MethodGet, "/auth/session", "")
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("post-logout GET /auth/session = %d, want 401", resp.StatusCode)
	}
	_ = resp.Body.Close()
}

func TestAuthFlowDeletedUserInvalidatesSession(t *testing.T) {
	t.Parallel()
	user := sqlcdb.User{
		ID:            "user-2",
		Email:         "gone@example.com",
		Password:      new(hashPassword(t, testPassword)),
		EmailVerified: new(time.Unix(1_700_000_000, 0)),
	}
	f := newFlowFixture(t, user)

	resp := f.do(t, http.MethodPost, "/auth/login", `{"email":"gone@example.com","password":"`+testPassword+`"}`)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("login = %d, want 204", resp.StatusCode)
	}
	_ = resp.Body.Close()

	// Delete the user out from under the live session.
	delete(f.store.byID, user.ID)

	resp = f.do(t, http.MethodGet, "/auth/session", "")
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("deleted-user GET /auth/session = %d, want 401", resp.StatusCode)
	}
	_ = resp.Body.Close()
}

func TestAuthFlowTransientDBErrorPreservesSession(t *testing.T) {
	t.Parallel()
	user := sqlcdb.User{
		ID:            "user-4",
		Email:         "blip@example.com",
		Password:      new(hashPassword(t, testPassword)),
		EmailVerified: new(time.Unix(1_700_000_000, 0)),
	}
	f := newFlowFixture(t, user)

	resp := f.do(t, http.MethodPost, "/auth/login", `{"email":"blip@example.com","password":"`+testPassword+`"}`)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("login = %d, want 204", resp.StatusCode)
	}
	_ = resp.Body.Close()

	// A transient DB error must NOT log the user out. The middleware preserves the
	// session and admits the request; GET /auth/session then re-resolves and, since
	// the blip persists, degrades to 503 rather than 401 (session still valid).
	f.store.idErr = context.DeadlineExceeded

	resp = f.do(t, http.MethodGet, "/auth/session", "")
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("transient GET /auth/session = %d, want 503 (session preserved, not 401)", resp.StatusCode)
	}
	_ = resp.Body.Close()

	// Recover: the same session works again once the DB is back.
	f.store.idErr = nil
	resp = f.do(t, http.MethodGet, "/auth/session", "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("recovered GET /auth/session = %d, want 200", resp.StatusCode)
	}
	_ = resp.Body.Close()
}

func TestAuthFlowPasswordRotationInvalidatesSession(t *testing.T) {
	t.Parallel()
	user := sqlcdb.User{
		ID:            "user-3",
		Email:         "rotate@example.com",
		Password:      new(hashPassword(t, testPassword)),
		EmailVerified: new(time.Unix(1_700_000_000, 0)),
	}
	f := newFlowFixture(t, user)

	resp := f.do(t, http.MethodPost, "/auth/login", `{"email":"rotate@example.com","password":"`+testPassword+`"}`)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("login = %d, want 204", resp.StatusCode)
	}
	_ = resp.Body.Close()

	// Rotate the password (new hash → different fingerprint) → session must die.
	rotated := user
	rotated.Password = new(hashPassword(t, "a-different-password"))
	f.store.add(rotated)

	resp = f.do(t, http.MethodGet, "/auth/session", "")
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("rotated-password GET /auth/session = %d, want 401", resp.StatusCode)
	}
	_ = resp.Body.Close()
}

func TestAuthFlowPasswordRemovalKeepsSession(t *testing.T) {
	t.Parallel()
	user := sqlcdb.User{
		ID:            "user-5",
		Email:         "sync@example.com",
		Password:      new(hashPassword(t, testPassword)),
		EmailVerified: new(time.Unix(1_700_000_000, 0)),
	}
	f := newFlowFixture(t, user)

	resp := f.do(t, http.MethodPost, "/auth/login", `{"email":"sync@example.com","password":"`+testPassword+`"}`)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("login = %d, want 204", resp.StatusCode)
	}
	_ = resp.Body.Close()

	// Removing the password (hash -> nil) is a fingerprint "sync", not a rotation: the
	// session survives (the FingerprintSync branch updates the stored fingerprint), e.g.
	// a user who dropped Email & Password sign-in but keeps an OAuth method.
	depassworded := user
	depassworded.Password = nil
	f.store.add(depassworded)

	resp = f.do(t, http.MethodGet, "/auth/session", "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("password-removed GET /auth/session = %d, want 200 (sync keeps the session)", resp.StatusCode)
	}
	_ = resp.Body.Close()
}

func TestAuthFlowHardDBErrorRejectsButPreservesSession(t *testing.T) {
	t.Parallel()
	user := sqlcdb.User{
		ID:            "user-6",
		Email:         "dberr@example.com",
		Password:      new(hashPassword(t, testPassword)),
		EmailVerified: new(time.Unix(1_700_000_000, 0)),
	}
	f := newFlowFixture(t, user)

	resp := f.do(t, http.MethodPost, "/auth/login", `{"email":"dberr@example.com","password":"`+testPassword+`"}`)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("login = %d, want 204", resp.StatusCode)
	}
	_ = resp.Body.Close()

	// A hard DB error that is neither transient nor ErrNoRows rejects the request (401)
	// but must NOT destroy the session — unlike a deleted user. 42P01 (undefined_table)
	// is not connection-class, so postgres.IsTransient treats it as permanent.
	f.store.idErr = &pgconn.PgError{Code: "42P01", Message: "undefined_table"}
	resp = f.do(t, http.MethodGet, "/auth/session", "")
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("hard-DB-error GET /auth/session = %d, want 401", resp.StatusCode)
	}
	_ = resp.Body.Close()

	// The session was preserved (not destroyed): once the DB recovers, the same cookie
	// authenticates again.
	f.store.idErr = nil
	resp = f.do(t, http.MethodGet, "/auth/session", "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("recovered GET /auth/session = %d, want 200 (session not destroyed)", resp.StatusCode)
	}
	_ = resp.Body.Close()
}
