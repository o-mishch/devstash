// Package redisconn provides the shared go-redis client used by the session store,
// rate limiter, one-time tokens, and OAuth pending-link. It mirrors the postgres
// package: a single tuned constructor that connects and fails fast on boot.
//
// The client is provider-agnostic — driven entirely by REDIS_URL. A "rediss://"
// URL (Upstash, primary) enables TLS automatically; a "redis://" URL (native
// Redis — local dev, GKE sandbox, testcontainers) connects in the clear. go-redis
// never needs to know which provider is behind the URL.
package redisconn

import (
	"context"
	"crypto/tls"
	"fmt"
	"log/slog"
	"time"

	"github.com/redis/go-redis/v9"
)

// Client tuning. Upstash drops idle connections and Cloud Run scales to zero, so
// keep no idle connections (go-redis reconnects on demand) and retry a few times
// to absorb the first-request-after-idle timeout. Timeouts bound a black-hole
// endpoint so boot fails fast instead of hanging.
const (
	poolSize     = 10
	minIdleConns = 0
	dialTimeout  = 5 * time.Second
	readTimeout  = 3 * time.Second
	writeTimeout = 3 * time.Second
	maxRetries   = 3
	pingTimeout  = 5 * time.Second
)

// Connect parses REDIS_URL, applies the tuning above, and validates the
// connection with a bounded PING. The logger is injected (not the slog global).
// Caller owns closing the returned client on shutdown.
func Connect(ctx context.Context, redisURL string, logger *slog.Logger) (*redis.Client, error) {
	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("redis: parse url: %w", err)
	}

	opt.PoolSize = poolSize
	opt.MinIdleConns = minIdleConns
	opt.DialTimeout = dialTimeout
	opt.ReadTimeout = readTimeout
	opt.WriteTimeout = writeTimeout
	opt.MaxRetries = maxRetries
	// ParseURL sets TLSConfig only for rediss:// URLs; pin a modern floor when it does.
	if opt.TLSConfig != nil {
		opt.TLSConfig.MinVersion = tls.VersionTLS12
	}

	client := redis.NewClient(opt)

	pingCtx, cancel := context.WithTimeout(ctx, pingTimeout)
	defer cancel()
	if err := client.Ping(pingCtx).Err(); err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("redis: ping: %w", err)
	}

	logger.InfoContext(ctx, "redis connected", "addr", opt.Addr, "tls", opt.TLSConfig != nil)
	return client, nil
}
