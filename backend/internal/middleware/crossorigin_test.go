package middleware

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func discardLogger() *slog.Logger { return slog.New(slog.DiscardHandler) }

// okHandler is the downstream that records whether the request reached it.
func okHandler(reached *bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		*reached = true
		w.WriteHeader(http.StatusNoContent)
	})
}

const (
	trustedOrigin = "https://devstash.one"
	apiHost       = "api.devstash.one"
)

// TestCrossOriginCSRF exercises the stdlib CrossOriginProtection guard through CrossOrigin:
// safe methods and non-browser/same-origin requests pass; a non-safe cross-site browser
// request is rejected unless its Origin is trusted. Covers both the Sec-Fetch-Site path
// and the Origin-vs-Host fallback (no Sec-Fetch-Site header).
func TestCrossOriginCSRF(t *testing.T) {
	t.Parallel()
	allow := []string{trustedOrigin, "https://www.devstash.one"}

	tests := []struct {
		name         string
		allowlist    []string
		method       string
		secFetchSite string // "" = header omitted
		origin       string // "" = header omitted
		wantStatus   int
		wantPassed   bool
	}{
		{
			name:      "safe GET from a cross-site context passes",
			allowlist: allow, method: http.MethodGet, secFetchSite: "cross-site", origin: "https://evil.example",
			wantStatus: http.StatusNoContent, wantPassed: true,
		},
		{
			name:      "same-origin POST passes",
			allowlist: allow, method: http.MethodPost, secFetchSite: "same-origin", origin: "https://" + apiHost,
			wantStatus: http.StatusNoContent, wantPassed: true,
		},
		{
			name:      "cross-site POST from an untrusted origin is 403",
			allowlist: allow, method: http.MethodPost, secFetchSite: "cross-site", origin: "https://evil.example",
			wantStatus: http.StatusForbidden, wantPassed: false,
		},
		{
			name:      "same-site POST from a trusted origin passes (the SPA subdomain)",
			allowlist: allow, method: http.MethodPost, secFetchSite: "same-site", origin: trustedOrigin,
			wantStatus: http.StatusNoContent, wantPassed: true,
		},
		{
			// A cross-site write from an allowlisted Origin must be admitted BY THE
			// ALLOWLIST — this is the only case that actually exercises AddTrustedOrigin
			// (the same-site case above passes regardless of it). If the allowlist wiring
			// broke, this would flip to a 403.
			name:      "cross-site POST from a trusted origin passes (exercises the allowlist)",
			allowlist: allow, method: http.MethodPost, secFetchSite: "cross-site", origin: trustedOrigin,
			wantStatus: http.StatusNoContent, wantPassed: true,
		},
		{
			name:      "POST with neither Sec-Fetch-Site nor Origin passes (non-browser client)",
			allowlist: allow, method: http.MethodPost, secFetchSite: "", origin: "",
			wantStatus: http.StatusNoContent, wantPassed: true,
		},
		{
			name:      "Origin/Host fallback: foreign Origin, no Sec-Fetch-Site is 403",
			allowlist: allow, method: http.MethodPost, secFetchSite: "", origin: "https://evil.example",
			wantStatus: http.StatusForbidden, wantPassed: false,
		},
		{
			name:      "empty allowlist still rejects a cross-site write (CSRF is always on)",
			allowlist: nil, method: http.MethodPost, secFetchSite: "cross-site", origin: "https://evil.example",
			wantStatus: http.StatusForbidden, wantPassed: false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			var passed bool
			h := CrossOrigin(tc.allowlist, discardLogger())(okHandler(&passed))

			req := httptest.NewRequestWithContext(
				context.Background(), tc.method, "https://"+apiHost+"/auth/login", nil,
			)
			req.Host = apiHost
			if tc.secFetchSite != "" {
				req.Header.Set("Sec-Fetch-Site", tc.secFetchSite)
			}
			if tc.origin != "" {
				req.Header.Set("Origin", tc.origin)
			}
			rr := httptest.NewRecorder()
			h.ServeHTTP(rr, req)

			if rr.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d; body = %s", rr.Code, tc.wantStatus, rr.Body.String())
			}
			if passed != tc.wantPassed {
				t.Errorf("downstream reached = %v, want %v", passed, tc.wantPassed)
			}
			if tc.wantStatus == http.StatusForbidden &&
				!strings.Contains(rr.Body.String(), "Cross-origin request rejected") {
				t.Errorf("403 body = %s, want the RFC 9457 problem document", rr.Body.String())
			}
		})
	}
}

// TestCrossOriginCORSPreflight verifies the rs/cors preflight response: an allowed origin
// gets credentialed CORS headers reflecting the exact origin (never "*"); a foreign origin
// gets none.
func TestCrossOriginCORSPreflight(t *testing.T) {
	t.Parallel()
	var reached bool
	h := CrossOrigin([]string{trustedOrigin}, discardLogger())(okHandler(&reached))

	t.Run("allowed origin gets credentialed CORS headers", func(t *testing.T) {
		t.Parallel()
		req := httptest.NewRequestWithContext(
			context.Background(), http.MethodOptions, "https://"+apiHost+"/auth/login", nil,
		)
		req.Header.Set("Origin", trustedOrigin)
		req.Header.Set("Access-Control-Request-Method", http.MethodPost)
		// The Fetch spec guarantees these are lowercase (which rs/cors matches case-
		// sensitively); a browser never sends canonical case here.
		req.Header.Set("Access-Control-Request-Headers", "content-type")
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)

		if got := rr.Header().Get("Access-Control-Allow-Origin"); got != trustedOrigin {
			t.Errorf("Access-Control-Allow-Origin = %q, want %q (never *)", got, trustedOrigin)
		}
		if got := rr.Header().Get("Access-Control-Allow-Credentials"); got != "true" {
			t.Errorf("Access-Control-Allow-Credentials = %q, want true", got)
		}
		if got := rr.Header().Get("Access-Control-Allow-Methods"); !strings.Contains(got, http.MethodPost) {
			t.Errorf("Access-Control-Allow-Methods = %q, want it to include POST", got)
		}
		if rr.Code >= 300 {
			t.Errorf("preflight status = %d, want a 2xx", rr.Code)
		}
	})

	t.Run("foreign origin gets no allow-origin header", func(t *testing.T) {
		t.Parallel()
		req := httptest.NewRequestWithContext(
			context.Background(), http.MethodOptions, "https://"+apiHost+"/auth/login", nil,
		)
		req.Header.Set("Origin", "https://evil.example")
		req.Header.Set("Access-Control-Request-Method", http.MethodPost)
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)

		if got := rr.Header().Get("Access-Control-Allow-Origin"); got != "" {
			t.Errorf("Access-Control-Allow-Origin = %q, want empty for a foreign origin", got)
		}
	})
}

// TestCrossOriginCORSActualRequest verifies a real (non-preflight) cross-origin GET from
// an allowed origin is passed through with the credentialed CORS headers set.
func TestCrossOriginCORSActualRequest(t *testing.T) {
	t.Parallel()
	var reached bool
	h := CrossOrigin([]string{trustedOrigin}, discardLogger())(okHandler(&reached))

	req := httptest.NewRequestWithContext(
		context.Background(), http.MethodGet, "https://"+apiHost+"/auth/session", nil,
	)
	req.Header.Set("Origin", trustedOrigin)
	req.Header.Set("Sec-Fetch-Site", "same-site")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if !reached {
		t.Fatal("downstream not reached for an allowed cross-origin GET")
	}
	if got := rr.Header().Get("Access-Control-Allow-Origin"); got != trustedOrigin {
		t.Errorf("Access-Control-Allow-Origin = %q, want %q", got, trustedOrigin)
	}
	if got := rr.Header().Get("Access-Control-Allow-Credentials"); got != "true" {
		t.Errorf("Access-Control-Allow-Credentials = %q, want true", got)
	}
}

// TestCrossOriginInvalidTrustedOriginPanics asserts a malformed ALLOWED_ORIGINS entry
// fails loudly at construction rather than silently dropping the origin.
func TestCrossOriginInvalidTrustedOriginPanics(t *testing.T) {
	t.Parallel()
	defer func() {
		if recover() == nil {
			t.Error("CrossOrigin with a malformed origin did not panic")
		}
	}()
	// A bare host with no scheme is not a valid origin.
	CrossOrigin([]string{"devstash.one"}, discardLogger())
}
