package cspreport

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humago"

	"github.com/o-mishch/devstash/backend/internal/middleware"
)

// This file pins the endpoint through the REAL cross-origin layer. Every other test here
// drives the handler via humatest, which registers the operation against a bare API — no
// rs/cors, no CrossOriginProtection. That proves the handler parses reports; it proves
// nothing about whether a browser's report ever REACHES the handler.
//
// The gap matters because the report POST is cross-origin by construction (beta. -> api.)
// and state-changing, so CrossOriginProtection — not the handler — decides its fate. If it
// rejected the reporting upload, the entire CSP telemetry path would 403 in production with
// the whole suite still green. The package doc asserts "the CORS/CSRF layer already trusts
// that origin"; these tests are what make that an assertion under test rather than a claim.
//
// The header shapes below are what CSP3 § Reporting specifies for a `report-uri` upload:
// method POST, `Content-Type: application/csp-report`, fetch mode "cors" and the document's
// origin — which makes the browser preflight, because application/csp-report is NOT a
// CORS-safelisted content type. Both legs are covered.

const spaOrigin = "https://beta.devstash.one"

// newCrossOriginServer wires the endpoint exactly as cmd/api does: the Huma operation on a
// ServeMux, wrapped in the real CrossOrigin middleware with the SPA origin allowlisted (prod
// sets ALLOWED_ORIGINS to exactly that — see local.spa_origin in infra/terraform/envs/prod).
func newCrossOriginServer(t *testing.T) (*httptest.Server, *bytes.Buffer) {
	t.Helper()
	var buf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug}))

	mux := http.NewServeMux()
	api := humago.New(mux, huma.DefaultConfig("test", "1.0.0"))
	Register(api, Deps{Limiter: fakeLimiter{}, Logger: logger, Cfg: Config{FailClosed: true}})

	srv := httptest.NewServer(middleware.CrossOrigin([]string{spaOrigin}, logger)(mux))
	t.Cleanup(srv.Close)
	return srv, &buf
}

func TestReportURIPostSurvivesCrossOriginLayer(t *testing.T) {
	t.Parallel()

	// A Firefox `report-uri` upload: cross-site, from the trusted SPA origin, carrying the
	// legacy CSP2 content type. CrossOriginProtection must let it through to the handler on
	// the strength of its Origin, and the violation must actually be logged.
	srv, buf := newCrossOriginServer(t)

	body := `{"csp-report":{"document-uri":"https://beta.devstash.one/",
		"blocked-uri":"https://evil.example/x.js","effective-directive":"script-src"}}`
	req, err := http.NewRequestWithContext(t.Context(), http.MethodPost, srv.URL+"/csp-report",
		strings.NewReader(body))
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	req.Header.Set("Content-Type", "application/csp-report")
	req.Header.Set("Origin", spaOrigin)
	req.Header.Set("Sec-Fetch-Site", "cross-site")
	req.Header.Set("Sec-Fetch-Mode", "cors")

	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatalf("post report: %v", err)
	}
	t.Cleanup(func() { _ = resp.Body.Close() })

	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("status = %d, want 204 — the cross-origin layer rejected a real browser "+
			"report upload; CSP telemetry would be dead in prod. logs: %s", resp.StatusCode, buf.String())
	}
	if !strings.Contains(buf.String(), "csp violation") {
		t.Errorf("report passed the middleware but was not logged; got %s", buf.String())
	}
	// The SPA origin must be echoed back, or the browser discards the response. Harmless for
	// a fire-and-forget beacon, but its absence means CORS did not recognise the origin.
	if got := resp.Header.Get("Access-Control-Allow-Origin"); got != spaOrigin {
		t.Errorf("Access-Control-Allow-Origin = %q, want %q", got, spaOrigin)
	}
}

func TestReportURIPreflightIsAllowed(t *testing.T) {
	t.Parallel()

	// `application/csp-report` is not a CORS-safelisted content type, so CSP3's mode:"cors"
	// report fetch preflights before the POST above ever leaves the browser. A preflight that
	// 403s kills the reporting path silently — no POST is ever sent, so no server-side log
	// would even record the loss.
	srv, _ := newCrossOriginServer(t)

	req, err := http.NewRequestWithContext(t.Context(), http.MethodOptions, srv.URL+"/csp-report", nil)
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	req.Header.Set("Origin", spaOrigin)
	req.Header.Set("Access-Control-Request-Method", http.MethodPost)
	req.Header.Set("Access-Control-Request-Headers", "content-type")

	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatalf("preflight: %v", err)
	}
	t.Cleanup(func() { _ = resp.Body.Close() })

	if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusOK {
		t.Fatalf("preflight status = %d, want 2xx", resp.StatusCode)
	}
	if got := resp.Header.Get("Access-Control-Allow-Origin"); got != spaOrigin {
		t.Errorf("preflight Access-Control-Allow-Origin = %q, want %q", got, spaOrigin)
	}
	if got := resp.Header.Get("Access-Control-Allow-Methods"); !strings.Contains(got, http.MethodPost) {
		t.Errorf("preflight Access-Control-Allow-Methods = %q, want it to include POST", got)
	}
}

func TestUntrustedOriginReportIsRejected(t *testing.T) {
	t.Parallel()

	// The flip side: the endpoint is public and unauthenticated, but it is not a free log-write
	// for any site on the internet. A cross-site POST from an origin outside ALLOWED_ORIGINS
	// must be stopped by the CSRF guard BEFORE the handler logs anything.
	srv, buf := newCrossOriginServer(t)

	req, err := http.NewRequestWithContext(t.Context(), http.MethodPost, srv.URL+"/csp-report",
		strings.NewReader(`{"csp-report":{"blocked-uri":"inline"}}`))
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	req.Header.Set("Content-Type", "application/csp-report")
	req.Header.Set("Origin", "https://evil.example")
	req.Header.Set("Sec-Fetch-Site", "cross-site")

	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatalf("post report: %v", err)
	}
	t.Cleanup(func() { _ = resp.Body.Close() })

	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 for an untrusted origin", resp.StatusCode)
	}
	// Pin WHICH layer rejected it. A 403 alone would also be satisfied by an unrelated future
	// failure, leaving this test green while the CSRF guard was gone.
	if !strings.Contains(buf.String(), "rejected cross-origin request (CSRF)") {
		t.Errorf("expected the CSRF guard to be what rejected it; got %s", buf.String())
	}
	if strings.Contains(buf.String(), "csp violation") {
		t.Errorf("an untrusted origin's report must not reach the log; got %s", buf.String())
	}
}
