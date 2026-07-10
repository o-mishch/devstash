// Package postgres provides the pgx connection pool shared by all sqlc-backed queries.
package postgres

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Pool tuning for a Neon (PgBouncer) backend behind a scale-to-zero service.
// Defaults (MaxConns = max(4, NumCPU), MinConns = 0) don't account for a shared
// serverless Postgres, so bound them explicitly and recycle connections before
// Neon's proxy drops them. These can move into config if they need to vary per env.
const (
	poolMaxConns              = 10
	poolMinConns              = 2
	poolMaxConnLifetime       = 30 * time.Minute
	poolMaxConnLifetimeJitter = 5 * time.Minute // stagger recycling, avoid thundering herd
	poolMaxConnIdleTime       = 5 * time.Minute
	// connectTimeout bounds the boot Ping. In serve the caller's ctx is the process
	// signal context (no deadline), so without this a black-hole DATABASE_URL would
	// hang the whole startup on the TCP/TLS handshake for the OS default (minutes)
	// instead of failing fast — which is the entire point of connecting on boot.
	connectTimeout = 10 * time.Second
)

// Connect creates and validates a pgxpool connection pool against the given
// DATABASE_URL. The logger is injected (not the slog global). Caller is
// responsible for calling pool.Close() on shutdown.
func Connect(ctx context.Context, databaseURL string, logger *slog.Logger) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("db: parse config: %w", err)
	}

	cfg.MaxConns = poolMaxConns
	cfg.MinConns = poolMinConns
	cfg.MaxConnLifetime = poolMaxConnLifetime
	cfg.MaxConnLifetimeJitter = poolMaxConnLifetimeJitter
	cfg.MaxConnIdleTime = poolMaxConnIdleTime
	cfg.HealthCheckPeriod = time.Minute
	// DATABASE_URL points at Neon's *pooled* endpoint (PgBouncer transaction mode),
	// where pgx's default named-prepared-statement caching fails with "prepared
	// statement already exists" as soon as a connection is reused across sessions.
	// QueryExecModeExec keeps the extended protocol (binary encoding, full type
	// fidelity) but uses unnamed statements, so nothing is cached across pooled
	// connections. It is also correct on a direct endpoint, so we set it always.
	// (QueryExecModeSimpleProtocol also works but downgrades every param to text.)
	cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeExec

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("db: create pool: %w", err)
	}

	// Bound the boot Ping so a bad host fails fast rather than hanging on the
	// deadline-less signal context (see connectTimeout).
	pingCtx, cancel := context.WithTimeout(ctx, connectTimeout)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("db: ping: %w", err)
	}

	logger.InfoContext(ctx, "database connected", "host", cfg.ConnConfig.Host, "database", cfg.ConnConfig.Database)
	return pool, nil
}
