package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/spf13/cobra"

	"github.com/o-mishch/devstash/backend/internal/config"
	"github.com/o-mishch/devstash/backend/internal/postgres"
)

func serveCmd(app *appState) *cobra.Command {
	return &cobra.Command{
		Use:   "serve",
		Short: "Start the HTTP server",
		RunE: func(cmd *cobra.Command, _ []string) error {
			return runServe(cmd.Context(), app.cfg, app.logger)
		},
	}
}

// HTTP server timeouts. Explicit values (net/http defaults to "no timeout")
// harden the server against slow-client and Slowloris attacks (gosec G112).
const (
	readHeaderTimeout = 5 * time.Second
	readTimeout       = 15 * time.Second
	writeTimeout      = 60 * time.Second
	idleTimeout       = 120 * time.Second
	shutdownTimeout   = 10 * time.Second
)

// runServe starts the HTTP server and blocks until an interrupt, then shuts down
// gracefully. Shared by the `serve` subcommand and the root command's default
// action (bare invocation), so buildpacks' argument-less launch also serves.
func runServe(ctx context.Context, cfg *config.Config, logger *slog.Logger) error {
	// Connect on boot to fail fast on a bad DATABASE_URL. No route reads the
	// pool yet (Phase 0 /health is DB-free); Phase 1 threads it into the router
	// with the first sqlc-backed handler.
	pool, err := postgres.Connect(ctx, cfg.DatabaseURL, logger)
	if err != nil {
		return err
	}
	defer pool.Close()

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           newRouter(),
		ReadHeaderTimeout: readHeaderTimeout, // Slowloris mitigation (gosec G112)
		ReadTimeout:       readTimeout,
		WriteTimeout:      writeTimeout,
		IdleTimeout:       idleTimeout,
	}

	// ListenAndServe blocks, so run it in a goroutine and surface a startup
	// failure (e.g. port in use) back through this channel — never os.Exit from
	// the goroutine, which would skip the deferred pool.Close() above.
	serverErr := make(chan error, 1)
	go func() {
		logger.InfoContext(ctx, "server listening", "addr", srv.Addr, "env", cfg.Env)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
		}
	}()

	select {
	case err := <-serverErr:
		return fmt.Errorf("server: %w", err)
	case <-ctx.Done():
		logger.InfoContext(ctx, "shutting down")
		// ctx is already cancelled (that's why we're here). WithoutCancel keeps its
		// values but drops the cancellation, so shutdown gets its full grace period
		// on a context still derived from ctx (no contextcheck suppression needed).
		shutCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), shutdownTimeout)
		defer cancel()
		return srv.Shutdown(shutCtx)
	}
}
