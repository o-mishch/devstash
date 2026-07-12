package main

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/o-mishch/devstash/backend/internal/config"
)

func discardLogger() *slog.Logger { return slog.New(slog.DiscardHandler) }

// startRedis brings up an in-process miniredis and returns its redis:// URL, torn
// down via t.Cleanup. Used by serve integration tests, which need the session
// store + rate limiter without a live Redis.
func startRedis(t *testing.T) string {
	t.Helper()
	return "redis://" + miniredis.RunT(t).Addr()
}

// startPostgres brings up a throwaway Postgres and returns its DSN; torn down via
// t.Cleanup. Isolated per test, so migrate/serve integration never touches Neon.
func startPostgres(t *testing.T) string {
	t.Helper()
	ctx := context.Background()

	container, err := postgres.Run(ctx, "postgres:17-alpine",
		postgres.WithDatabase("devstash_test"),
		postgres.WithUsername("test"),
		postgres.WithPassword("test"),
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

// freePort reserves an ephemeral port, then releases it so runServe can bind it.
// The brief gap is an accepted race — nothing else in the test binds ports.
func freePort(t *testing.T) string {
	t.Helper()
	var lc net.ListenConfig
	ln, err := lc.Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve port: %v", err)
	}
	_, port, err := net.SplitHostPort(ln.Addr().String())
	if err != nil {
		t.Fatalf("split host port: %v", err)
	}
	if err := ln.Close(); err != nil {
		t.Fatalf("close reserved listener: %v", err)
	}
	return port
}

// TestMigrateUpStatusDown replays the embedded goose baseline against a fresh
// database and rolls it back, covering the migrate subcommands end to end.
func TestMigrateUpStatusDown(t *testing.T) {
	app := &appState{
		cfg:    &config.Config{DatabaseURL: startPostgres(t)},
		logger: discardLogger(),
	}

	// Execute every registered migrate subcommand (up, down, status) via the real
	// command tree rather than string args — exercises the wiring and each RunE.
	for _, sub := range migrateCmd(app).Commands() {
		sub.SetArgs(nil)
		if err := sub.Execute(); err != nil {
			t.Fatalf("migrate %s: %v", sub.Name(), err)
		}
	}
}

// TestRunServeGracefulShutdown starts the real server against a live DB, confirms
// /health serves, then cancels the context and asserts a clean shutdown (nil error).
func TestRunServeGracefulShutdown(t *testing.T) {
	cfg := &config.Config{
		Port:        freePort(t),
		DatabaseURL: startPostgres(t),
		RedisURL:    startRedis(t),
		Env:         "test",
	}

	ctx, cancel := context.WithCancel(context.Background())
	serveErr := make(chan error, 1)
	go func() { serveErr <- runServe(ctx, cfg, discardLogger()) }()

	healthURL := "http://127.0.0.1:" + cfg.Port + "/health"
	waitForHealth(t, healthURL)

	cancel() // trigger graceful shutdown
	select {
	case err := <-serveErr:
		if err != nil {
			t.Fatalf("runServe returned error on shutdown: %v", err)
		}
	case <-time.After(shutdownTimeout + 5*time.Second):
		t.Fatal("runServe did not return after context cancellation")
	}
}

// waitForHealth polls until the server answers 200 or a deadline elapses. A plain
// loop is used deliberately: it blocks on network I/O with a backoff (the sanctioned
// exception to the no-classic-loop rule), which range-over-func cannot express.
func waitForHealth(t *testing.T, url string) {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, url, nil)
		if err != nil {
			t.Fatalf("build health request: %v", err)
		}
		resp, err := http.DefaultClient.Do(req)
		if err == nil {
			_ = resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("server never became healthy at %s", url)
}
