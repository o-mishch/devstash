// Package health exposes the service liveness endpoint. It is the first domain
// package and sets the vertical-slice shape Phase 1 domains follow: a package per
// domain that owns its Huma operations and registers them via a Register(api) func.
package health

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
)

type healthOutput struct {
	Body struct {
		Status string `example:"ok" json:"status"`
	}
}

// Register attaches GET /health to the API. Liveness only — it intentionally does
// not touch the database, so a transient DB blip can't make the platform's liveness
// probe kill an otherwise-healthy instance. A DB-aware readiness check lands with
// the pool in Phase 1.
func Register(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-health",
		Method:      http.MethodGet,
		Path:        "/health",
		Summary:     "Health check",
		Tags:        []string{"system"},
	}, func(_ context.Context, _ *struct{}) (*healthOutput, error) {
		resp := &healthOutput{}
		resp.Body.Status = "ok"
		return resp, nil
	})
}
