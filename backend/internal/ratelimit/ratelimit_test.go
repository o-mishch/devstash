package ratelimit

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func newTestLimiter(t *testing.T) *RedisLimiter {
	t.Helper()
	mr := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	return New(client)
}

func TestAllowWithinAndOverBudget(t *testing.T) {
	t.Parallel()
	l := newTestLimiter(t)
	ctx := context.Background()

	// register allows 3 per hour; the first three succeed, the fourth is denied.
	for i := range 3 {
		dec, err := l.Allow(ctx, BucketRegister, "1.2.3.4")
		if err != nil {
			t.Fatalf("Allow #%d error = %v", i+1, err)
		}
		if !dec.Allowed {
			t.Fatalf("Allow #%d denied, want allowed", i+1)
		}
	}

	dec, err := l.Allow(ctx, BucketRegister, "1.2.3.4")
	if err != nil {
		t.Fatalf("Allow #4 error = %v", err)
	}
	if dec.Allowed {
		t.Error("Allow #4 allowed, want denied (budget exhausted)")
	}
	if dec.RetryAfter <= 0 {
		t.Errorf("RetryAfter = %v, want a positive wait", dec.RetryAfter)
	}
}

func TestAllowKeysAreIndependent(t *testing.T) {
	t.Parallel()
	l := newTestLimiter(t)
	ctx := context.Background()

	// Exhaust one key; a different key under the same bucket is unaffected.
	for range 3 {
		if _, err := l.Allow(ctx, BucketRegister, "10.0.0.1"); err != nil {
			t.Fatalf("prime error = %v", err)
		}
	}
	dec, err := l.Allow(ctx, BucketRegister, "10.0.0.2")
	if err != nil {
		t.Fatalf("Allow other key error = %v", err)
	}
	if !dec.Allowed {
		t.Error("second key denied, want allowed (keys are independent)")
	}
}

// TestAllowWindowResets proves a key recovers after its window elapses — the
// complement of TestAllowWithinAndOverBudget, which only proved exhaustion. The GCRA
// bucket drains over time, so an exhausted key is allowed again once the period passes.
//
// Driven by miniredis.FastForward, not testing/synctest: redis_rate's GCRA runs as a
// Lua script inside Redis and reads the server's own clock (redis.call('TIME')), which
// FastForward advances. synctest's fake time lives only in this process and never
// reaches the (mini)redis server, so it cannot move a server-side rate-limit window.
func TestAllowWindowResets(t *testing.T) {
	t.Parallel()
	mr := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	l := New(client)
	ctx := context.Background()

	// register = 3 per hour. Exhaust it, then confirm the 4th is denied.
	for i := range 3 {
		if _, err := l.Allow(ctx, BucketRegister, "1.2.3.4"); err != nil {
			t.Fatalf("prime #%d error = %v", i+1, err)
		}
	}
	if dec, err := l.Allow(ctx, BucketRegister, "1.2.3.4"); err != nil {
		t.Fatalf("over-budget Allow error = %v", err)
	} else if dec.Allowed {
		t.Fatal("4th Allow within the window was allowed, want denied")
	}

	// Advance the server clock past the 1h window; the bucket has drained.
	mr.FastForward(time.Hour + time.Minute)

	dec, err := l.Allow(ctx, BucketRegister, "1.2.3.4")
	if err != nil {
		t.Fatalf("post-window Allow error = %v", err)
	}
	if !dec.Allowed {
		t.Error("Allow after the window elapsed was denied, want allowed (the window should reset)")
	}
}

func TestAllowUnknownBucketErrors(t *testing.T) {
	t.Parallel()
	l := newTestLimiter(t)
	if _, err := l.Allow(context.Background(), "not-a-bucket", "k"); err == nil {
		t.Fatal("Allow(unknown bucket) error = nil, want an error (fail closed)")
	}
}
