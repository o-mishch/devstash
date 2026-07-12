package auth

import (
	"errors"
	"net/http"
	"testing"

	"github.com/danielgtaylor/huma/v2/humatest"
)

func TestLogoutSuccess(t *testing.T) {
	t.Parallel()
	sess := &fakeSessions{}
	d := New(Deps{Sessions: sess, Logger: discardLogger()})

	_, api := humatest.New(t)
	registerLogout(api, d)

	resp := api.Post("/auth/logout")
	if resp.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204; body = %s", resp.Code, resp.Body.String())
	}
	if !sess.destroyed {
		t.Error("session was not destroyed")
	}
}

func TestLogoutDestroyErrorIs500(t *testing.T) {
	t.Parallel()
	d := New(Deps{Sessions: &fakeSessions{destroyErr: errors.New("redis down")}, Logger: discardLogger()})

	_, api := humatest.New(t)
	registerLogout(api, d)

	resp := api.Post("/auth/logout")
	if resp.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body = %s", resp.Code, resp.Body.String())
	}
}

// TestSessionReResolveFailureIs503 drives the transient-DB branch of GET /auth/session:
// the middleware admitted the request without a stashed user, so the handler
// re-resolves by id and returns 503 when that lookup also fails.
func TestSessionReResolveFailureIs503(t *testing.T) {
	t.Parallel()
	store := newFakeUserStore()
	store.idErr = errors.New("connection refused")
	d := New(Deps{Users: store, Sessions: &fakeSessions{}, Logger: discardLogger()})

	_, api := humatest.New(t)
	registerSession(api, d)

	resp := api.Get("/auth/session")
	if resp.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503; body = %s", resp.Code, resp.Body.String())
	}
	// The degraded response carries Retry-After so the SPA retries the probe rather
	// than treating the transient blip as a logout.
	if got := resp.Header().Get("Retry-After"); got != "5" {
		t.Errorf("Retry-After = %q, want 5", got)
	}
}
