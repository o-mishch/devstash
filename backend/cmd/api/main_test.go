package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/humatest"
	"github.com/redis/go-redis/v9"
	"github.com/spf13/cobra"

	"github.com/o-mishch/devstash/backend/internal/session"
)

// newTestSessions builds a session.Manager backed by an in-memory miniredis, so
// router/wiring tests exercise the real scs store without a live Redis.
func newTestSessions(t *testing.T) *session.Manager {
	t.Helper()
	mr := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	return session.New(client, session.Config{Lifetime: session.MaxAge, IdleTimeout: session.IdleTimeout})
}

// TestHealthRoute exercises the registered /health operation through Huma's own
// test harness (real request routing + response validation), not a hand-rolled
// handler call — so it also catches operation-registration and schema mistakes.
func TestHealthRoute(t *testing.T) {
	_, api := humatest.New(t)
	registerRoutes(api, domains{}, nil)

	resp := api.Get("/health")

	if resp.Code != http.StatusOK {
		t.Fatalf("GET /health status = %d, want %d", resp.Code, http.StatusOK)
	}
	if body := resp.Body.String(); !strings.Contains(body, `"status":"ok"`) {
		t.Errorf("GET /health body = %q, want it to contain \"status\":\"ok\"", body)
	}
}

// TestNewHumaAPIProducesSpec guards the offline `openapi emit` path: building the
// API must yield an OpenAPI doc that includes the registered /health path. This
// is the contract CI serializes, so a missing route here is a real regression.
func TestNewHumaAPIProducesSpec(t *testing.T) {
	api := newHumaAPI()
	doc := api.OpenAPI()

	if doc.Paths == nil {
		t.Fatal("OpenAPI document has no paths")
	}
	if _, ok := doc.Paths["/health"]; !ok {
		t.Errorf("OpenAPI document missing /health path; got paths %v", doc.Paths)
	}
}

// TestNewRouterServesHealth exercises the full stdlib-mux + humago router (not just the API
// object) end to end via httptest, covering newRouter/mountAPI wiring.
func TestNewRouterServesHealth(t *testing.T) {
	rr := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/health", nil)

	newRouter(newTestSessions(t), domains{}, nil, nil, nil, true, slog.New(slog.DiscardHandler)).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("GET /health status = %d, want %d", rr.Code, http.StatusOK)
	}
	if !strings.Contains(rr.Body.String(), `"status":"ok"`) {
		t.Errorf("GET /health body = %q, want it to contain \"status\":\"ok\"", rr.Body.String())
	}
}

// TestNewRouterServesDocs verifies that the Huma out-of-the-box Swagger UI is served
// at /docs with correct CSP and content headers when enabled.
func TestNewRouterServesDocs(t *testing.T) {
	rr := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/docs", nil)

	newRouter(newTestSessions(t), domains{}, nil, nil, nil, true, slog.New(slog.DiscardHandler)).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("GET /docs status = %d, want %d", rr.Code, http.StatusOK)
	}
	if contentType := rr.Header().Get("Content-Type"); !strings.Contains(contentType, "text/html") {
		t.Errorf("GET /docs Content-Type = %q, want it to contain \"text/html\"", contentType)
	}
	if csp := rr.Header().Get("Content-Security-Policy"); !strings.Contains(csp, "connect-src 'self'") {
		t.Errorf("GET /docs CSP = %q, want it to contain \"connect-src 'self'\"", csp)
	}
	body := rr.Body.String()
	if !strings.Contains(body, "swagger-ui") {
		t.Errorf("GET /docs body missing Swagger UI container")
	}
}

// TestNewRouterHidesDocs verifies that the /docs route returns 404 Not Found
// when docs are disabled (to protect the auth attack surface in production).
func TestNewRouterHidesDocs(t *testing.T) {
	rr := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/docs", nil)

	newRouter(newTestSessions(t), domains{}, nil, nil, nil, false, slog.New(slog.DiscardHandler)).ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Errorf("GET /docs status = %d, want %d (Not Found)", rr.Code, http.StatusNotFound)
	}
}

// TestHumaConfig pins the settings the migration relies on: SwaggerUI served
// in-process at /docs when enabled, both server URLs present, and — when docs are
// disabled (production) — the docs/spec/schema routes all switched off so the auth
// attack surface isn't published.
func TestHumaConfig(t *testing.T) {
	t.Run("docs enabled serves SwaggerUI + spec", func(t *testing.T) {
		cfg := humaConfig(true)
		if cfg.DocsRenderer != huma.DocsRendererSwaggerUI {
			t.Errorf("DocsRenderer = %q, want %q (SwaggerUI)", cfg.DocsRenderer, huma.DocsRendererSwaggerUI)
		}
		if cfg.DocsPath == "" {
			t.Error("DocsPath is empty, want the docs route enabled")
		}
		if cfg.OpenAPIPath == "" {
			t.Error("OpenAPIPath is empty, want the spec route enabled for Swagger UI")
		}
		if len(cfg.Servers) != 2 {
			t.Fatalf("Servers count = %d, want 2 (prod + local)", len(cfg.Servers))
		}
	})

	t.Run("docs disabled hides docs and spec routes", func(t *testing.T) {
		cfg := humaConfig(false)
		if cfg.DocsPath != "" {
			t.Errorf("DocsPath = %q, want empty (disabled)", cfg.DocsPath)
		}
		if cfg.OpenAPIPath != "" {
			t.Errorf("OpenAPIPath = %q, want empty (disabled)", cfg.OpenAPIPath)
		}
		if cfg.SchemasPath != "" {
			t.Errorf("SchemasPath = %q, want empty (disabled)", cfg.SchemasPath)
		}
	})
}

// TestSkipConfigLoad checks the annotation walk against the real command tree: the
// emit child of the annotated `openapi` command must be skipped (annotations aren't
// inherited, so the walk must climb to the parent), while a command with no annotated
// ancestor must not be. Using the production openapiCmd also guards its wiring.
func TestSkipConfigLoad(t *testing.T) {
	emit := openapiCmd().Commands()[0] // `emit`, child of the offline `openapi` command
	if !skipConfigLoad(emit) {
		t.Error("skipConfigLoad(openapi emit) = false, want true")
	}

	plain := &cobra.Command{Use: "plain"}
	if skipConfigLoad(plain) {
		t.Error("skipConfigLoad(plain) = true, want false")
	}
}

// TestOpenapiEmitWritesSpec runs the whole `openapi emit` command through the root,
// with NO required env set — the PersistentPreRunE must skip config load for the
// offline openapi subtree, then emit must write a valid OpenAPI document.
func TestOpenapiEmitWritesSpec(t *testing.T) {
	out := filepath.Join(t.TempDir(), "openapi.json")

	root := rootCmd()
	root.SetArgs([]string{"openapi", "emit", out})
	if err := root.Execute(); err != nil {
		t.Fatalf("openapi emit: %v", err)
	}

	b, err := os.ReadFile(out)
	if err != nil {
		t.Fatalf("read emitted spec: %v", err)
	}
	var doc map[string]any
	if err := json.Unmarshal(b, &doc); err != nil {
		t.Fatalf("emitted spec is not valid JSON: %v", err)
	}
	if _, ok := doc["openapi"]; !ok {
		t.Errorf("emitted spec missing top-level \"openapi\" field; got keys %v", doc)
	}
}
