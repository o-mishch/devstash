package cspreport

import (
	"bytes"
	"context"
	"log/slog"
	"net/http"
	"strings"
	"testing"

	"github.com/danielgtaylor/huma/v2/humatest"

	"github.com/o-mishch/devstash/backend/internal/ratelimit"
)

// fakeLimiter is an in-memory ratelimit.Limiter: it allows by default, or denies / errors
// when configured, so a test can drive the flood-guard branch without Redis.
type fakeLimiter struct {
	deny bool
	err  error
}

func (f fakeLimiter) Allow(_ context.Context, _, _ string) (ratelimit.Decision, error) {
	if f.err != nil {
		return ratelimit.Decision{}, f.err
	}
	return ratelimit.Decision{Allowed: !f.deny}, nil
}

// newTestAPI registers the endpoint against a humatest API with the given limiter and a
// logger that captures its output, so a test can assert both status and what was logged.
func newTestAPI(t *testing.T, limiter ratelimit.Limiter) (humatest.TestAPI, *bytes.Buffer) {
	t.Helper()
	var buf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug}))
	_, api := humatest.New(t)
	Register(api, Deps{Limiter: limiter, Logger: logger, Cfg: Config{FailClosed: true}})
	return api, &buf
}

const reportsContentType = "Content-Type: application/reports+json"

func TestIngestsViolationAndLogsIt(t *testing.T) {
	t.Parallel()
	api, buf := newTestAPI(t, fakeLimiter{})

	body := `[{"type":"csp-violation","url":"https://beta.devstash.one/",
		"body":{"documentURL":"https://beta.devstash.one/","blockedURL":"inline",
		"effectiveDirective":"script-src","disposition":"enforce"}}]`

	resp := api.Post("/csp-report", reportsContentType, strings.NewReader(body))

	if resp.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204; body = %s", resp.Code, resp.Body.String())
	}
	logged := buf.String()
	if !strings.Contains(logged, "csp violation") || !strings.Contains(logged, "script-src") {
		t.Errorf("expected the violation to be logged with its directive; got %s", logged)
	}
}

func TestUnparseablePayloadStillReturns204(t *testing.T) {
	t.Parallel()
	api, buf := newTestAPI(t, fakeLimiter{})

	// A single object (legacy `application/csp-report` shape) is not the reports+json
	// array we parse — the endpoint must swallow it, not 500, so a browser's out-of-band
	// POST never surfaces an error.
	resp := api.Post("/csp-report", reportsContentType, strings.NewReader(`{"not":"an-array"}`))

	if resp.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204; body = %s", resp.Code, resp.Body.String())
	}
	if !strings.Contains(buf.String(), "unparseable payload") {
		t.Errorf("expected an unparseable-payload log; got %s", buf.String())
	}
}

func TestNonCSPReportTypeIsSkipped(t *testing.T) {
	t.Parallel()
	api, buf := newTestAPI(t, fakeLimiter{})

	// Reporting endpoints can be shared across report types; a non-CSP entry must not be
	// logged as a violation.
	body := `[{"type":"deprecation","url":"https://beta.devstash.one/","body":{}}]`
	resp := api.Post("/csp-report", reportsContentType, strings.NewReader(body))

	if resp.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204; body = %s", resp.Code, resp.Body.String())
	}
	if strings.Contains(buf.String(), "csp violation") {
		t.Errorf("non-CSP report should not log a violation; got %s", buf.String())
	}
}

func TestRateLimitedReturns429AndDoesNotLog(t *testing.T) {
	t.Parallel()
	api, buf := newTestAPI(t, fakeLimiter{deny: true})

	body := `[{"type":"csp-violation","url":"https://beta.devstash.one/","body":{"blockedURL":"inline"}}]`
	resp := api.Post("/csp-report", reportsContentType, strings.NewReader(body))

	if resp.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429; body = %s", resp.Code, resp.Body.String())
	}
	// Over-budget requests must be dropped before the log line — that's the flood guard.
	if strings.Contains(buf.String(), "csp violation") {
		t.Errorf("rate-limited report should not be logged; got %s", buf.String())
	}
}

func TestLimiterOutageFailsClosed(t *testing.T) {
	t.Parallel()
	api, _ := newTestAPI(t, fakeLimiter{err: context.DeadlineExceeded})

	body := `[{"type":"csp-violation","url":"https://beta.devstash.one/","body":{}}]`
	resp := api.Post("/csp-report", reportsContentType, strings.NewReader(body))

	if resp.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429 (fail-closed on limiter outage); body = %s", resp.Code, resp.Body.String())
	}
}
