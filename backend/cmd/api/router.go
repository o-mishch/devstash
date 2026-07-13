package main

import (
	"log/slog"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humago"

	"github.com/o-mishch/devstash/backend/internal/auth"
	"github.com/o-mishch/devstash/backend/internal/health"
	"github.com/o-mishch/devstash/backend/internal/middleware"
	"github.com/o-mishch/devstash/backend/internal/session"
)

// newRouter builds the HTTP handler: the Huma API on the stdlib net/http.ServeMux
// (via humago — no third-party router), wrapped in scs.LoadAndSave (session cookie
// read in, committed + Set-Cookie out), then fronted by the cross-origin layer
// (CORS + stdlib CSRF) and, outermost, request-id tagging and panic recovery.
//
// Layers, applied outside-in (RequestID first, handlers last):
//
//		RequestID -> Recover -> CrossOrigin (CORS+CSRF) -> scs LoadAndSave -> API
//
//	  - RequestID tags each request with a fresh X-Request-Id (readable via reqid.From,
//	    echoed on the response). The logging handler folds that id into every *Context log
//	    call, so one request is correlated across the CSRF log, the panic log, and every
//	    auth/session handler log by its id.
//	  - Recover is the panic safety net: Huma does not recover handler panics (only
//	    response transforms are guarded), so without it a panic escapes to net/http,
//	    which drops the connection with no response. Recover turns it into a logged,
//	    RFC 9457 500 and keeps the server up. Placed under RequestID so the panic is
//	    attributable, and outside CrossOrigin/LoadAndSave so it covers those too.
//
// The stdlib ServeMux replaces go-chi/chi: since the only chi feature ever used was a
// bare NewRouter(), and its RequestID/Recoverer clash with this service's slog +
// RFC 9457 posture, both are hand-rolled above (~70 lines) and the dependency dropped.
// chi's RealIP is deliberately NOT reproduced: it trusts the leftmost X-Forwarded-For
// entry, which is attacker-controlled on Cloud Run and would reintroduce the per-IP
// rate-limit bypass that the rightmost-trusted middleware.clientIP was written to close.
func newRouter(
	sm *session.Manager,
	deps auth.Deps,
	users middleware.UserByIDStore,
	readiness health.Pinger,
	allowedOrigins []string,
	docsEnabled bool,
	logger *slog.Logger,
) http.Handler {
	mux := http.NewServeMux()
	mountAPI(mux, sm, deps, users, readiness, docsEnabled, logger)
	handler := middleware.CrossOrigin(allowedOrigins, logger)(sm.LoadAndSave(mux))
	return middleware.RequestID(middleware.Recover(logger)(handler))
}

// newHumaAPI builds the Huma API on a throwaway ServeMux for offline OpenAPI
// generation. Handlers never run, so zero-value deps are safe — only operation
// shapes and the security scheme matter for the spec. docsEnabled is irrelevant here
// (the emitted document is identical either way) so it's left on.
//
// Providers is populated with both OAuth providers (empty credentials — only their
// operation shapes matter, Exchange never runs during emit) so the OAuth start/callback
// and /auth/link operations appear in the emitted spec regardless of which secrets a
// given deploy configures. Serving still registers OAuth per-configured-provider (see
// buildOAuthProviders); this fixed set is the spec-generation input only.
func newHumaAPI() huma.API {
	deps := auth.Deps{Providers: map[string]auth.OAuthProvider{
		"github": auth.NewGitHubProvider("", "", ""),
		"google": auth.NewGoogleProvider("", "", ""),
	}}
	return mountAPI(http.NewServeMux(), nil, deps, nil, nil, true, slog.Default())
}

// mountAPI builds the Huma API on the given ServeMux, installs the request
// middleware, and registers all domain routes. Single source of wiring, shared by
// newRouter (serving) and newHumaAPI (spec generation).
func mountAPI(
	mux *http.ServeMux,
	sm *session.Manager,
	deps auth.Deps,
	users middleware.UserByIDStore,
	readiness health.Pinger,
	docsEnabled bool,
	logger *slog.Logger,
) huma.API {
	api := humago.New(mux, humaConfig(docsEnabled))
	// ClientIP stashes the connecting RemoteAddr (rate-limit fallback when XFF is
	// absent); RequireSession enforces Operation.Security.
	api.UseMiddleware(
		middleware.ClientIP(deps.Cfg.TrustedProxyDepth),
		middleware.RequireSession(api, sm, users, logger),
	)
	registerRoutes(api, deps, readiness)
	return api
}

// humaConfig builds the Huma config. When docsEnabled is false the SwaggerUI page and
// the raw OpenAPI/JSON-schema routes are disabled — in production they'd publish the
// auth attack surface, and the build-time `openapi emit` subcommand produces the spec
// for client codegen regardless of this runtime flag.
func humaConfig(docsEnabled bool) huma.Config {
	cfg := huma.DefaultConfig("DevStash API", "0.1.0")
	cfg.Servers = []*huma.Server{
		{URL: "https://api.devstash.one", Description: "Production"},
		{URL: "http://localhost:8080", Description: "Local dev"},
	}
	if docsEnabled {
		// SwaggerUI at /docs — served in-process, no npm/Node dependency.
		cfg.DocsPath = "/docs"
	} else {
		cfg.DocsPath = ""
		cfg.OpenAPIPath = ""
		cfg.SchemasPath = ""
	}
	// The session is an opaque httpOnly cookie; document it so secured operations
	// reference a real scheme and SwaggerUI shows the auth requirement.
	cfg.Components.SecuritySchemes = map[string]*huma.SecurityScheme{
		middleware.SessionScheme: {
			Type: "apiKey",
			In:   "cookie",
			Name: session.CookieName,
		},
	}
	return cfg
}

// registerRoutes attaches every domain's operations to the API. Each domain owns its
// Register func; health carries the liveness/readiness probes (readiness pings the DB),
// auth carries the Phase 1 session surface.
func registerRoutes(api huma.API, deps auth.Deps, readiness health.Pinger) {
	health.Register(api, readiness)
	auth.Register(api, deps)
}
