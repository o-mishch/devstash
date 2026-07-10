package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/danielgtaylor/huma/v2/humatest"
	"github.com/spf13/cobra"
)

// TestHealthRoute exercises the registered /health operation through Huma's own
// test harness (real request routing + response validation), not a hand-rolled
// handler call — so it also catches operation-registration and schema mistakes.
func TestHealthRoute(t *testing.T) {
	_, api := humatest.New(t)
	registerRoutes(api)

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

// TestNewRouterServesHealth exercises the full chi+humachi router (not just the API
// object) end to end via httptest, covering newRouter/mountAPI wiring.
func TestNewRouterServesHealth(t *testing.T) {
	rr := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/health", nil)

	newRouter().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("GET /health status = %d, want %d", rr.Code, http.StatusOK)
	}
	if !strings.Contains(rr.Body.String(), `"status":"ok"`) {
		t.Errorf("GET /health body = %q, want it to contain \"status\":\"ok\"", rr.Body.String())
	}
}

// TestHumaConfig pins the two settings the migration relies on: SwaggerUI served
// in-process at /docs, and both server URLs present in the emitted spec.
func TestHumaConfig(t *testing.T) {
	cfg := humaConfig()

	if cfg.DocsPath != "/docs" {
		t.Errorf("DocsPath = %q, want /docs", cfg.DocsPath)
	}
	if len(cfg.Servers) != 2 {
		t.Fatalf("Servers count = %d, want 2 (prod + local)", len(cfg.Servers))
	}
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
