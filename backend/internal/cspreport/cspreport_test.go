package cspreport

import (
	"bytes"
	"context"
	"log/slog"
	"net/http"
	"slices"
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

// legacyContentType is what a `report-uri` directive makes the browser send. The handler reads
// RawBody and never inspects the content type, so this is not load-bearing today — it pins the
// legacy tests to the transport they claim to cover, rather than passing for the wrong reason.
const legacyContentType = "Content-Type: application/csp-report"

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

	// Neither the reports+json array nor the legacy `csp-report` object: an arbitrary JSON
	// object decodes cleanly into the legacy struct but carries no report fields, so it must
	// stay "unparseable" rather than be logged as an empty violation. The endpoint must
	// swallow it, not 500, so a browser's out-of-band POST never surfaces an error.
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

// countLogged reports how many records the JSON handler wrote with the given message.
func countLogged(logged, msg string) int {
	return strings.Count(logged, `"msg":"`+msg+`"`)
}

// truncatedMsg is the entry-cap notice, spelled exactly as the handler logs it — countLogged
// matches the whole `"msg":"…"` field, so a paraphrase silently counts zero and the assertion
// passes for the wrong reason.
const truncatedMsg = "csp-report: entries truncated"

// repeatEntries builds a reports+json array of n identical entries.
func repeatEntries(n int, entry string) string {
	return "[" + strings.Repeat(entry+",", n-1) + entry + "]"
}

func TestViolationLogLinesAreCappedPerRequest(t *testing.T) {
	t.Parallel()

	// The flood guard charges one rate-limit token per REQUEST, but the handler logs one line
	// per VIOLATION — so a single in-budget POST must not buy an unbounded number of lines.
	// 1000 entries is the realistic attack: it fits well inside maxReportBytes (32KB), so the
	// byte cap does NOT catch it and only maxReportEntries can.
	tests := []struct {
		name    string
		entries int
	}{
		{name: "flood that fits inside the byte cap is truncated", entries: 1000},
		{name: "small legitimate batch is truncated at the cap", entries: maxReportEntries + 5},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			api, buf := newTestAPI(t, fakeLimiter{})

			body := repeatEntries(tc.entries, `{"type":"csp-violation"}`)
			resp := api.Post("/csp-report", reportsContentType, strings.NewReader(body))

			if resp.Code != http.StatusNoContent {
				t.Fatalf("status = %d, want 204; body = %s", resp.Code, resp.Body.String())
			}
			logged := buf.String()
			if got := countLogged(logged, "csp violation"); got > maxReportEntries {
				t.Errorf("logged %d violation lines for %d entries, want at most %d",
					got, tc.entries, maxReportEntries)
			}
			// Every case here drops real violations, so the cap must announce itself: a silent
			// cap set too low would eat the very reports that would prove it is too low, and
			// one bounded line per request cannot reopen the flood.
			if got := countLogged(logged, truncatedMsg); got != 1 {
				t.Errorf("truncation notices = %d, want exactly 1 for %d violations; got %s",
					got, tc.entries, logged)
			}
		})
	}
}

func TestFillerEntriesDoNotCrowdOutViolations(t *testing.T) {
	t.Parallel()
	api, buf := newTestAPI(t, fakeLimiter{})

	// The cap bounds LOG LINES, not array entries — so it must be applied AFTER the type
	// filter. A capful of filler ahead of one real violation is the case that separates the
	// two designs: capping raw entries would spend the whole budget on `{}` and silently drop
	// the only report worth having. Every other flood test is blind to the difference.
	filler := strings.Repeat(`{},`, maxReportEntries)
	body := "[" + filler + `{"type":"csp-violation","body":{"effectiveDirective":"script-src"}}]`

	resp := api.Post("/csp-report", reportsContentType, strings.NewReader(body))

	if resp.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204; body = %s", resp.Code, resp.Body.String())
	}
	logged := buf.String()
	if got := countLogged(logged, "csp violation"); got != 1 {
		t.Errorf("violations logged = %d, want 1 behind %d filler entries; got %s",
			got, maxReportEntries, logged)
	}
	if !strings.Contains(logged, "script-src") {
		t.Errorf("expected the violation's directive to survive the filler; got %s", logged)
	}
	// Filler is not a dropped violation — announcing truncation here would be a false alarm.
	if got := countLogged(logged, truncatedMsg); got != 0 {
		t.Errorf("truncation notices = %d, want 0; filler is not truncated cargo; got %s", got, logged)
	}
}

func TestHugeFillerFloodLogsNothing(t *testing.T) {
	t.Parallel()
	api, buf := newTestAPI(t, fakeLimiter{})

	// The original report: one oversized array of type-less filler, sized to fit inside
	// maxReportBytes (~30KB) so that only the entry handling can bound it. Filler is not a
	// violation, so the whole array collapses to nothing — one request must never produce
	// ~10^4 log lines.
	body := repeatEntries(10_000, `{}`)
	resp := api.Post("/csp-report", reportsContentType, strings.NewReader(body))

	logged := buf.String()
	if got := countLogged(logged, "csp violation"); got != 0 {
		t.Errorf("logged %d violation lines for a 10,000-entry filler array (status %d), want 0",
			got, resp.Code)
	}
	// Nothing loggable was dropped, so claiming truncation would be a false alarm — the notice
	// is reserved for real violations the cap actually ate.
	if got := countLogged(logged, truncatedMsg); got != 0 {
		t.Errorf("truncation notices = %d, want 0; no violation was dropped; got %s", got, logged)
	}
}

func TestUntruncatedArrayLogsNoTruncationNotice(t *testing.T) {
	t.Parallel()
	api, buf := newTestAPI(t, fakeLimiter{})

	// Exactly at the cap: nothing was dropped, so claiming truncation would be a false alarm
	// on the ordinary path — the boundary is where an off-by-one would show up.
	entries := strings.Repeat(`{"type":"csp-violation","body":{"blockedURL":"inline"}},`, maxReportEntries)
	body := "[" + strings.TrimSuffix(entries, ",") + "]"

	resp := api.Post("/csp-report", reportsContentType, strings.NewReader(body))

	if resp.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204; body = %s", resp.Code, resp.Body.String())
	}
	if got := countLogged(buf.String(), "csp violation"); got != maxReportEntries {
		t.Errorf("violations logged = %d, want %d", got, maxReportEntries)
	}
	if got := countLogged(buf.String(), truncatedMsg); got != 0 {
		t.Errorf("truncation notices = %d, want 0 at exactly the cap; got %s", got, buf.String())
	}
}

func TestTypelessEntriesAreNotViolations(t *testing.T) {
	t.Parallel()
	api, buf := newTestAPI(t, fakeLimiter{})

	// A type-less entry is filler, not a violation — the type match is strict, so `[{},{}]`
	// must log nothing at all.
	resp := api.Post("/csp-report", reportsContentType, strings.NewReader(`[{},{}]`))

	if resp.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204; body = %s", resp.Code, resp.Body.String())
	}
	if got := countLogged(buf.String(), "csp violation"); got != 0 {
		t.Errorf("type-less entries logged %d violations, want 0; got %s", got, buf.String())
	}
}

func TestLegacyReportURIPayloadIsParsed(t *testing.T) {
	t.Parallel()

	// The SPA's policy ships `report-uri` (Firefox honours only that), which makes the browser
	// POST the CSP2 single-object hyphenated-key shape. It must produce a real violation log,
	// not the diagnostics-free "unparseable" line. Posted with the content type Firefox
	// actually sends, so the guarantee stays pinned to the real transport rather than to the
	// modern one the handler is only incidentally lenient about.
	tests := []struct {
		name     string
		body     string
		wantLogs []string
	}{
		{
			name: "firefox csp-report object",
			body: `{"csp-report":{"document-uri":"https://beta.devstash.one/",
				"blocked-uri":"https://evil.example/x.js","effective-directive":"script-src",
				"source-file":"https://beta.devstash.one/app.js","line-number":42}}`,
			wantLogs: []string{"csp violation", "https://evil.example/x.js", "script-src"},
		},
		{
			name:     "blocked-uri only still reports",
			body:     `{"csp-report":{"blocked-uri":"inline"}}`,
			wantLogs: []string{"csp violation", "inline"},
		},
		{
			// An older UA sends only the historic directive name; the log's most useful
			// field must not come out blank.
			name:     "violated-directive fallback when effective-directive is absent",
			body:     `{"csp-report":{"blocked-uri":"inline","violated-directive":"style-src"}}`,
			wantLogs: []string{"csp violation", "inline", "style-src"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			api, buf := newTestAPI(t, fakeLimiter{})

			resp := api.Post("/csp-report", legacyContentType, strings.NewReader(tc.body))

			if resp.Code != http.StatusNoContent {
				t.Fatalf("status = %d, want 204; body = %s", resp.Code, resp.Body.String())
			}
			logged := buf.String()
			for want := range slices.Values(tc.wantLogs) {
				if !strings.Contains(logged, want) {
					t.Errorf("expected %q in the log; got %s", want, logged)
				}
			}
			if strings.Contains(logged, "unparseable payload") {
				t.Errorf("legacy payload must not be logged as unparseable; got %s", logged)
			}
		})
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
