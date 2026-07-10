package main

import (
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"

	"github.com/o-mishch/devstash/backend/internal/health"
)

// newRouter creates the chi router backed by a Huma API, ready to serve HTTP.
// humachi registers routes onto the chi router in-place, so returning r gives
// an http.Handler with all routes already attached.
func newRouter() http.Handler {
	r := chi.NewRouter()
	mountAPI(r)
	return r
}

// newHumaAPI creates a Huma API on a throwaway chi router. Used by openapiCmd to
// generate the spec without needing an HTTP server.
func newHumaAPI() huma.API {
	return mountAPI(chi.NewRouter())
}

// mountAPI builds the Huma API on the given chi router and registers all routes.
// Single source of truth for wiring, shared by newRouter and newHumaAPI.
func mountAPI(r chi.Router) huma.API {
	api := humachi.New(r, humaConfig())
	registerRoutes(api)
	return api
}

func humaConfig() huma.Config {
	cfg := huma.DefaultConfig("DevStash API", "0.1.0")
	cfg.Servers = []*huma.Server{
		{URL: "https://api.devstash.one", Description: "Production"},
		{URL: "http://localhost:8080", Description: "Local dev"},
	}
	// SwaggerUI at /docs — served in-process, no npm/Node dependency.
	cfg.DocsPath = "/docs"
	return cfg
}

// registerRoutes attaches every domain's operations to the API. Each domain owns
// its own package and Register func (health today; auth/items/… land in Phase 1).
func registerRoutes(api huma.API) {
	health.Register(api)
}
