package postgres

import (
	"context"
	"log/slog"
	"testing"
	"time"

	"github.com/testcontainers/testcontainers-go"
	// Aliased: this test's own package is also named postgres, so tcpostgres keeps
	// the testcontainers module clearly distinct from the package under test.
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

func testLogger() *slog.Logger { return slog.New(slog.DiscardHandler) }

// startPostgres brings up a throwaway Postgres for the test and tears it down via
// t.Cleanup. Uses the testcontainers postgres module; the container is isolated per
// test, so cases stay parallel-safe and never touch the shared Neon dev branch.
func startPostgres(t *testing.T) string {
	t.Helper()
	ctx := context.Background()

	container, err := tcpostgres.Run(ctx, "postgres:17-alpine",
		tcpostgres.WithDatabase("devstash_test"),
		tcpostgres.WithUsername("test"),
		tcpostgres.WithPassword("test"),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2).WithStartupTimeout(60*time.Second),
		),
	)
	if err != nil {
		t.Fatalf("start postgres container: %v", err)
	}
	t.Cleanup(func() {
		if termErr := testcontainers.TerminateContainer(container); termErr != nil {
			t.Logf("terminate postgres container: %v", termErr)
		}
	})

	connStr, err := container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("connection string: %v", err)
	}
	return connStr
}

// TestConnectParseError covers the fast-fail path: a DSN with an unsupported scheme
// is rejected by pgxpool.ParseConfig before any network I/O.
func TestConnectParseError(t *testing.T) {
	_, err := Connect(context.Background(), "http://not-postgres", testLogger())
	if err == nil {
		t.Fatal("Connect() error = nil, want a parse error for an invalid DSN")
	}
}

// TestConnectPingError covers the unreachable-database path: the DSN parses, but the
// pool's boot Ping fails against a dead address, so Connect closes the pool and errors.
func TestConnectPingError(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	// Port 1 has no listener; ParseConfig succeeds, Ping fails.
	_, err := Connect(ctx, "postgres://user:pass@127.0.0.1:1/db", testLogger())
	if err == nil {
		t.Fatal("Connect() error = nil, want a ping error against a dead address")
	}
}

// TestConnectSucceeds is the happy path against a real Postgres: the pool connects,
// the boot Ping passes, and the returned pool is usable.
func TestConnectSucceeds(t *testing.T) {
	connStr := startPostgres(t)

	pool, err := Connect(context.Background(), connStr, testLogger())
	if err != nil {
		t.Fatalf("Connect() error = %v, want nil", err)
	}
	defer pool.Close()

	var one int
	if err := pool.QueryRow(context.Background(), "SELECT 1").Scan(&one); err != nil {
		t.Fatalf("query on returned pool: %v", err)
	}
	if one != 1 {
		t.Errorf("SELECT 1 = %d, want 1", one)
	}
}
