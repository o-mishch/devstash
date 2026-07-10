// Package postgres provides the pgx connection pool shared by all sqlc-backed queries.
package postgres

import (
	"context"
	"fmt"
	"log/slog"
	"time"

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
	// NOTE: if we connect through Neon's *pooled* endpoint (PgBouncer transaction
	// mode), prepared-statement caching must be disabled or queries fail with
	// "prepared statement already exists". Prefer QueryExecModeExec — it keeps the
	// extended protocol (binary encoding, full type fidelity) while using unnamed
	// statements, so nothing is cached across pooled connections:
	//   cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeExec
	// (QueryExecModeSimpleProtocol also works but downgrades every param to text.)

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("db: create pool: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("db: ping: %w", err)
	}

	logger.InfoContext(ctx, "database connected", "host", cfg.ConnConfig.Host, "database", cfg.ConnConfig.Database)
	return pool, nil
}
