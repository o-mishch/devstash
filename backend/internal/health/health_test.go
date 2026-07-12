package health

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"testing"

	"github.com/danielgtaylor/huma/v2/humatest"
)

// fakePinger is a Pinger whose Ping calls are counted, so a test can assert the
// readiness cache/single-flight actually collapses redundant database round-trips.
type fakePinger struct {
	mu    sync.Mutex
	calls int
	err   error
}

func (f *fakePinger) Ping(context.Context) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	return f.err
}

func (f *fakePinger) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

func TestCheckCachesWithinWindow(t *testing.T) {
	p := &fakePinger{}
	var c cachedPing
	if err := c.check(context.Background(), p); err != nil {
		t.Fatalf("first check: %v", err)
	}
	if err := c.check(context.Background(), p); err != nil {
		t.Fatalf("second check: %v", err)
	}
	if got := p.count(); got != 1 {
		t.Errorf("Ping called %d times, want 1 (the second read within 1s must hit the cache)", got)
	}
}

func TestCheckPropagatesAndCachesError(t *testing.T) {
	sentinel := errors.New("db down")
	p := &fakePinger{err: sentinel}
	var c cachedPing
	if err := c.check(context.Background(), p); !errors.Is(err, sentinel) {
		t.Fatalf("check err = %v, want %v", err, sentinel)
	}
	if err := c.check(context.Background(), p); !errors.Is(err, sentinel) {
		t.Fatalf("cached check err = %v, want %v", err, sentinel)
	}
	if got := p.count(); got != 1 {
		t.Errorf("Ping called %d times, want 1 (the error is cached like a success)", got)
	}
}

// TestCheckSingleFlightUnderConcurrency is the point of the P4-1 fix: a burst of
// concurrent /readyz probes against a cold cache must collapse to a single ping, and
// nothing may hold the cache mutex across the ping (verified under -race). The first
// refresher pings once under probing; every other goroutine sees the fresh cache or the
// double-check inside probing, so the DB is touched exactly once.
func TestCheckSingleFlightUnderConcurrency(t *testing.T) {
	p := &fakePinger{}
	var c cachedPing
	const n = 50
	var wg sync.WaitGroup
	wg.Add(n)
	for range n {
		go func() {
			defer wg.Done()
			_ = c.check(context.Background(), p)
		}()
	}
	wg.Wait()
	if got := p.count(); got != 1 {
		t.Errorf("Ping called %d times across %d concurrent probes, want 1", got, n)
	}
}

func TestRegisterProbes(t *testing.T) {
	t.Run("health is ok without touching the database", func(t *testing.T) {
		_, api := humatest.New(t)
		Register(api, &fakePinger{err: errors.New("down")}) // liveness must ignore the DB
		if resp := api.Get("/health"); resp.Code != http.StatusOK {
			t.Errorf("status = %d, want 200; body = %s", resp.Code, resp.Body.String())
		}
	})

	t.Run("readyz ok when the ping succeeds", func(t *testing.T) {
		_, api := humatest.New(t)
		Register(api, &fakePinger{})
		if resp := api.Get("/readyz"); resp.Code != http.StatusOK {
			t.Errorf("status = %d, want 200; body = %s", resp.Code, resp.Body.String())
		}
	})

	t.Run("readyz 503 when the ping fails", func(t *testing.T) {
		_, api := humatest.New(t)
		Register(api, &fakePinger{err: errors.New("db down")})
		if resp := api.Get("/readyz"); resp.Code != http.StatusServiceUnavailable {
			t.Errorf("status = %d, want 503; body = %s", resp.Code, resp.Body.String())
		}
	})

	t.Run("readyz ok with a nil pinger (offline spec-gen path)", func(t *testing.T) {
		_, api := humatest.New(t)
		Register(api, nil)
		if resp := api.Get("/readyz"); resp.Code != http.StatusOK {
			t.Errorf("status = %d, want 200; body = %s", resp.Code, resp.Body.String())
		}
	})
}
