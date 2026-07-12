package auth

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/o-mishch/devstash/backend/internal/ratelimit"
)

func TestNormalizeEmail(t *testing.T) {
	t.Parallel()
	if got := normalizeEmail("  Foo@Example.COM  "); got != "foo@example.com" {
		t.Errorf("normalizeEmail = %q, want foo@example.com", got)
	}
}

func TestDeniedMessage(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name       string
		retryAfter time.Duration
		want       string
	}{
		{name: "sub-minute", retryAfter: 20 * time.Second, want: "Too many attempts. Please try again in a moment."},
		{name: "exactly one minute", retryAfter: time.Minute, want: "Too many attempts. Please try again in a moment."},
		{
			name:       "rounds up to minutes",
			retryAfter: 61 * time.Second,
			want:       "Too many attempts. Please try again in 2 minutes.",
		},
		{
			name:       "fifteen minutes",
			retryAfter: 15 * time.Minute,
			want:       "Too many attempts. Please try again in 15 minutes.",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := deniedMessage(tc.retryAfter); got != tc.want {
				t.Errorf("deniedMessage(%v) = %q, want %q", tc.retryAfter, got, tc.want)
			}
		})
	}
}

func TestEnforceLimitFailMode(t *testing.T) {
	t.Parallel()

	t.Run("fail open in development returns nil", func(t *testing.T) {
		t.Parallel()
		d := New(Deps{
			Limiter: &fakeLimiter{err: errors.New("redis down")},
			Logger:  discardLogger(),
			Cfg:     Config{FailClosed: false},
		})
		if err := d.enforceLimit(context.Background(), ratelimit.BucketLogin, "k"); err != nil {
			t.Errorf("enforceLimit fail-open err = %v, want nil", err)
		}
	})

	t.Run("fail closed in production returns 429", func(t *testing.T) {
		t.Parallel()
		d := New(Deps{
			Limiter: &fakeLimiter{err: errors.New("redis down")},
			Logger:  discardLogger(),
			Cfg:     Config{FailClosed: true},
		})
		if err := d.enforceLimit(context.Background(), ratelimit.BucketLogin, "k"); err == nil {
			t.Error("enforceLimit fail-closed err = nil, want a 429 error")
		}
	})

	t.Run("allowed returns nil", func(t *testing.T) {
		t.Parallel()
		d := New(Deps{Limiter: &fakeLimiter{}, Logger: discardLogger()})
		if err := d.enforceLimit(context.Background(), ratelimit.BucketLogin, "k"); err != nil {
			t.Errorf("enforceLimit allowed err = %v, want nil", err)
		}
	})
}
