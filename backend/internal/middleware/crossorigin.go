package middleware

import (
	"fmt"
	"log/slog"
	"net/http"
	"slices"

	"github.com/rs/cors"
)

// forbiddenOriginBody is the RFC 9457 problem document returned when the CSRF guard
// rejects a cross-site request. Written directly because this is a net/http middleware
// that runs outside Huma's error machinery, but the shape matches Huma's errors.
const forbiddenOriginBody = `{"title":"Forbidden","status":403,"detail":"Cross-origin request rejected."}`

// corsPreflightMaxAge caps how long (seconds) a browser may cache a CORS preflight.
const corsPreflightMaxAge = 600

// CrossOrigin builds the browser cross-origin security layer for the API: the stdlib
// CSRF guard (net/http.CrossOriginProtection) always, wrapped by a CORS response-header
// and preflight handler (rs/cors) when origins are configured.
//
// Order, outermost first: CORS -> CSRF -> next. CORS answers the preflight and sets the
// Access-Control-* headers on every response (so the SPA can read even a 403); the CSRF
// guard then rejects any non-safe cross-site request before it reaches the session store
// or a handler.
//
// CSRF (CrossOriginProtection) runs regardless of configuration: GET/HEAD/OPTIONS and
// requests without Sec-Fetch-Site/Origin (non-browser clients — mobile Bearer, curl,
// server-to-server — and the same-origin Vite dev proxy) always pass, so it is safe even
// in local dev. CORS response headers are only meaningful cross-origin, so when the
// allowlist is empty (local dev behind the Vite same-origin proxy) CORS is disabled —
// this also avoids rs/cors's "empty list means allow-all (*)" default, which would be
// unsafe with credentials.
func CrossOrigin(allowedOrigins []string, logger *slog.Logger) func(http.Handler) http.Handler {
	csrf := csrfGuard(allowedOrigins, logger)
	if len(allowedOrigins) == 0 {
		logger.Warn("CORS disabled: ALLOWED_ORIGINS is empty (expected only in local dev behind the Vite proxy)")
		return csrf
	}

	corsMW := cors.New(cors.Options{
		// Explicit origins only — never "*". Credentialed CORS forbids the wildcard, and
		// an over-broad match would let a subdomain takeover forge credentialed requests.
		AllowedOrigins: allowedOrigins,
		AllowedMethods: []string{
			http.MethodGet, http.MethodHead, http.MethodPost,
			http.MethodPut, http.MethodPatch, http.MethodDelete,
		},
		// Content-Type for the JSON body; Authorization so a future Bearer/mobile client
		// works without a CORS change.
		AllowedHeaders:   []string{"Authorization", "Content-Type"},
		AllowCredentials: true,
		MaxAge:           corsPreflightMaxAge,
	})
	return func(next http.Handler) http.Handler {
		return corsMW.Handler(csrf(next))
	}
}

// csrfGuard builds the stdlib CrossOriginProtection middleware. It rejects non-safe
// (state-changing) cross-site browser requests using the Sec-Fetch-Site header, with an
// Origin-vs-Host fallback for pre-2023 browsers, unless the request's Origin is on the
// trusted allowlist. Rejections return an RFC 9457 403 (matching the API error shape) and
// are logged. A malformed allowlist entry is an operator config error, so it fails loudly
// at construction (startup) rather than silently dropping the origin.
func csrfGuard(trustedOrigins []string, logger *slog.Logger) func(http.Handler) http.Handler {
	p := http.NewCrossOriginProtection()
	// Value-only range (tier 2): AddTrustedOrigin is a side-effecting call returning a
	// per-origin error, which the tier-1 slices algorithm helpers cannot express.
	for origin := range slices.Values(trustedOrigins) {
		if err := p.AddTrustedOrigin(origin); err != nil {
			panic(fmt.Sprintf("middleware: invalid ALLOWED_ORIGINS entry %q: %v", origin, err))
		}
	}
	p.SetDenyHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		logger.WarnContext(r.Context(), "rejected cross-origin request (CSRF)",
			"origin", r.Header.Get("Origin"),
			"secFetchSite", r.Header.Get("Sec-Fetch-Site"),
			"method", r.Method,
			"path", r.URL.Path,
		)
		writeProblem(w, http.StatusForbidden, forbiddenOriginBody)
	}))
	return p.Handler
}
