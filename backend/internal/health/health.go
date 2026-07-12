// Package health exposes the service liveness endpoint. It is the first domain
// package and sets the vertical-slice shape Phase 1 domains follow: a package per
// domain that owns its Huma operations and registers them via a Register(api) func.
package health

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/danielgtaylor/huma/v2"
)

type healthOutput struct {
	Body struct {
		Status string `example:"ok" json:"status"`
	}
}

// Pinger is the readiness probe's data dependency: anything that can round-trip to the
// datastore. Satisfied by *pgxpool.Pool; nil in the offline spec-generation path (the
// readiness handler never runs there).
type Pinger interface {
	Ping(ctx context.Context) error
}

type cachedPing struct {
	mu        sync.Mutex // guards the cached result below
	lastPing  time.Time
	lastError error
	probing   sync.Mutex // serialises at most one in-flight refresh
}

// probeTimeout bounds a readiness ping so it can never ride the server's full write
// timeout: a hung database fails the probe fast instead of stacking every concurrent
// /readyz behind one slow ping.
const probeTimeout = 2 * time.Second

// check returns the cached readiness error, refreshing it (at most once per second)
// without holding mu across the ping — so a slow database never blocks probes reading
// the cached result, and probing lets only one refresh run at a time.
func (c *cachedPing) check(ctx context.Context, db Pinger) error {
	c.mu.Lock()
	fresh := time.Since(c.lastPing) < time.Second
	lastErr := c.lastError
	c.mu.Unlock()
	if fresh {
		return lastErr
	}

	c.probing.Lock()
	defer c.probing.Unlock()
	// Another goroutine may have refreshed while we waited on probing.
	c.mu.Lock()
	if time.Since(c.lastPing) < time.Second {
		lastErr = c.lastError
		c.mu.Unlock()
		return lastErr
	}
	c.mu.Unlock()

	pingCtx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()
	err := db.Ping(pingCtx)

	c.mu.Lock()
	c.lastError = err
	c.lastPing = time.Now()
	c.mu.Unlock()
	return err
}

// Register attaches the system probes to the API:
//   - GET /health   liveness — never touches the database, so a transient DB blip can't
//     make the platform's liveness probe kill an otherwise-healthy instance.
//   - GET /readyz    readiness — pings the database so the platform gates traffic until
//     the datastore is reachable. Kept distinct from liveness precisely so a momentary
//     DB outage sheds new traffic without triggering a restart loop.
func Register(api huma.API, db Pinger) {
	huma.Register(api, huma.Operation{
		OperationID: "get-health",
		Method:      http.MethodGet,
		Path:        "/health",
		Summary:     "Liveness check",
		Tags:        []string{"system"},
	}, func(_ context.Context, _ *struct{}) (*healthOutput, error) {
		resp := &healthOutput{}
		resp.Body.Status = "ok"
		return resp, nil
	})

	var cache cachedPing

	huma.Register(api, huma.Operation{
		OperationID: "get-readiness",
		Method:      http.MethodGet,
		Path:        "/readyz",
		Summary:     "Readiness check",
		Tags:        []string{"system"},
	}, func(ctx context.Context, _ *struct{}) (*healthOutput, error) {
		// db is nil only during offline spec generation, where this handler never runs.
		if db != nil {
			if err := cache.check(ctx, db); err != nil {
				return nil, huma.Error503ServiceUnavailable("The service is not ready.")
			}
		}
		resp := &healthOutput{}
		resp.Body.Status = "ok"
		return resp, nil
	})
}
