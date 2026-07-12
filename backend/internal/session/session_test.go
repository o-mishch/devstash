package session

import (
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

// TestAuthenticateRenewsToken pins the session-fixation defense: Authenticate calls
// scs.RenewToken, so a token that already exists before authentication is replaced by a
// fresh one afterwards — an attacker-planted session token cannot survive a login.
func TestAuthenticateRenewsToken(t *testing.T) {
	t.Parallel()
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	m := New(rdb, Config{Lifetime: MaxAge, IdleTimeout: IdleTimeout})

	// A handler that authenticates the current request's session.
	h := m.LoadAndSave(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		if err := m.Authenticate(r.Context(), "u1", "fp000000"); err != nil {
			t.Errorf("authenticate: %v", err)
		}
	}))

	// First request: no cookie in → Authenticate mints token t1.
	rec1 := httptest.NewRecorder()
	h.ServeHTTP(rec1, httptest.NewRequest(http.MethodPost, "/", nil))
	t1 := sessionCookieValue(rec1.Result().Cookies())

	// Second request carrying t1: Authenticate renews → a different token t2, and t1 is
	// invalidated.
	req2 := httptest.NewRequest(http.MethodPost, "/", nil)
	req2.AddCookie(&http.Cookie{Name: CookieName, Value: t1})
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req2)
	t2 := sessionCookieValue(rec2.Result().Cookies())

	if t1 == "" || t2 == "" {
		t.Fatalf("expected a session cookie on both responses; got %q then %q", t1, t2)
	}
	if t1 == t2 {
		t.Error("session token did not change across Authenticate — RenewToken (fixation defense) not applied")
	}
}

// TestSessionIdleTimeoutExpiry pins the idle-timeout envelope: an inactive session
// becomes anonymous once IdleTimeout elapses, forcing a re-login. scs enforces this
// entirely through the store key's TTL (Commit sets expiry = now+IdleTimeout; Load
// never re-checks the clock, it just trusts the store to have dropped an expired key),
// so miniredis.FastForward — which advances the Redis TTL clock — is the correct
// instrument. testing/synctest's fake time never reaches the (mini)redis server and so
// cannot expire a store-side key, which is why it is deliberately not used here.
func TestSessionIdleTimeoutExpiry(t *testing.T) {
	t.Parallel()
	const idle = 30 * time.Minute
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	m := New(rdb, Config{Lifetime: MaxAge, IdleTimeout: idle})

	// Establish an authenticated session and capture its token.
	authH := m.LoadAndSave(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		if err := m.Authenticate(r.Context(), "u1", "fp000000"); err != nil {
			t.Errorf("authenticate: %v", err)
		}
	}))
	rec := httptest.NewRecorder()
	authH.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/", nil))
	token := sessionCookieValue(rec.Result().Cookies())
	if token == "" {
		t.Fatal("no session cookie issued on authentication")
	}

	// load runs one request carrying the token and returns the UserID scs resolved.
	var seen string
	readH := m.LoadAndSave(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		seen = m.UserID(r.Context())
	}))
	load := func() string {
		seen = ""
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.AddCookie(&http.Cookie{Name: CookieName, Value: token})
		readH.ServeHTTP(httptest.NewRecorder(), req)
		return seen
	}

	// Just inside the idle window the session is still live. This activity also refreshes
	// the store TTL (the whole point of a rolling idle timeout), resetting the clock.
	mr.FastForward(idle - time.Minute)
	if got := load(); got != "u1" {
		t.Fatalf("UserID within the idle window = %q, want u1", got)
	}

	// Past the (refreshed) idle window with no activity: the store key TTLs away and scs
	// resolves an anonymous session — a forced re-login.
	mr.FastForward(idle + time.Minute)
	if got := load(); got != "" {
		t.Errorf("UserID after the idle window = %q, want empty (the session should have expired)", got)
	}
}

// sessionCookieValue returns the value of the session cookie in cookies, or "".
func sessionCookieValue(cookies []*http.Cookie) string {
	i := slices.IndexFunc(cookies, func(c *http.Cookie) bool { return c.Name == CookieName })
	if i < 0 {
		return ""
	}
	return cookies[i].Value
}
