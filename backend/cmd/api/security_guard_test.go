package main

import (
	"maps"
	"testing"

	"github.com/danielgtaylor/huma/v2"

	"github.com/o-mishch/devstash/backend/internal/middleware"
)

// publicOperations is the explicit allowlist of operations that are intentionally
// reachable WITHOUT a session: the system probes and the pre-auth credential flows
// (you can't be logged in while logging in). Every other operation MUST declare the
// session security scheme. Adding a new public endpoint is a deliberate act: add its
// OperationID here, in the same PR, with review.
var publicOperations = map[string]bool{
	"get-health":               true, // liveness probe
	"get-readiness":            true, // readiness probe
	"auth-login":               true, // establishes the session
	"auth-register":            true, // no session yet
	"auth-verify-email":        true, // consumes an emailed token
	"auth-resend-verification": true, // pre-auth, enumeration-safe
	"auth-forgot-password":     true, // pre-auth, enumeration-safe
	"auth-reset-password":      true, // consumes an emailed token
	"auth-confirm-login-email": true, // consumes an emailed token
	// OAuth: start/callback are the pre-auth sign-in round-trip (no session yet);
	// callback validates a single-use state token, not a cookie. /auth/link is
	// authorized by the pending-link token + a password re-check, not a session.
	"auth-oauth-github-start":    true, // pre-auth OAuth initiation
	"auth-oauth-github-callback": true, // provider redirect; state-token guarded
	"auth-oauth-google-start":    true, // pre-auth OAuth initiation
	"auth-oauth-google-callback": true, // provider redirect; state-token guarded
	"auth-oauth-link":            true, // pending-link token + password, not a session
}

// TestEveryOperationIsSecuredOrAllowlisted is the default-deny guard for the API's
// authentication posture. Huma enforces auth per-operation via Operation.Security, so
// a new protected endpoint that simply forgets the Security field ships silently
// PUBLIC — the single highest-impact footgun in a Huma service (a well-known
// missing-authorization vulnerability class). This test converts that silent mistake
// into a red CI line: every registered operation must either declare the session
// scheme or be on the reviewed publicOperations allowlist. It walks the real,
// fully-wired OpenAPI document (the same one newHumaAPI emits), so it can never drift
// from what the service actually serves.
func TestEveryOperationIsSecuredOrAllowlisted(t *testing.T) {
	doc := newHumaAPI().OpenAPI()
	if doc.Paths == nil {
		t.Fatal("OpenAPI document has no paths — the API registered no operations")
	}

	seen := map[string]bool{}
	for path, item := range doc.Paths {
		for method, op := range operations(item) {
			if op.OperationID == "" {
				t.Errorf("%s %s has no OperationID — cannot classify its auth posture", method, path)
				continue
			}
			seen[op.OperationID] = true

			secured := declaresSessionScheme(op)
			public := publicOperations[op.OperationID]

			switch {
			case public && secured:
				t.Errorf(
					"operation %q (%s %s) is on the public allowlist but ALSO declares the session scheme — "+
						"remove it from publicOperations or drop its Security",
					op.OperationID, method, path,
				)
			case !public && !secured:
				t.Errorf(
					"operation %q (%s %s) is NOT secured and NOT on the public allowlist — add "+
						"Security: []map[string][]string{{middleware.SessionScheme: {}}} to the operation, "+
						"or (if it is genuinely public) add its OperationID to publicOperations with a reason",
					op.OperationID, method, path,
				)
			}
		}
	}

	// Keep the allowlist honest: an entry for an operation that no longer exists is
	// dead config that could mask a future same-named endpoint being left public.
	for id := range publicOperations {
		if !seen[id] {
			t.Errorf("publicOperations lists %q, but no such operation is registered — remove the stale entry", id)
		}
	}
}

// declaresSessionScheme reports whether the operation requires the session security
// scheme (mirrors middleware.requiresSession, which is what actually enforces it at
// runtime — asserting on the same shape the middleware keys off).
func declaresSessionScheme(op *huma.Operation) bool {
	for _, requirement := range op.Security {
		if _, ok := requirement[middleware.SessionScheme]; ok {
			return true
		}
	}
	return false
}

// operations returns the non-nil operations defined on a path item, keyed by HTTP
// method. Huma models each verb as a separate pointer field rather than a map, so we
// enumerate them explicitly.
func operations(item *huma.PathItem) map[string]*huma.Operation {
	byMethod := map[string]*huma.Operation{
		"GET":     item.Get,
		"PUT":     item.Put,
		"POST":    item.Post,
		"DELETE":  item.Delete,
		"OPTIONS": item.Options,
		"HEAD":    item.Head,
		"PATCH":   item.Patch,
		"TRACE":   item.Trace,
	}
	maps.DeleteFunc(byMethod, func(_ string, op *huma.Operation) bool { return op == nil })
	return byMethod
}
