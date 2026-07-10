// Command api is the DevStash Go API server: `serve`, `migrate`, and `openapi`.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/spf13/cobra"

	"github.com/o-mishch/devstash/backend/db"
	"github.com/o-mishch/devstash/backend/internal/config"
	"github.com/o-mishch/devstash/backend/internal/logging"
	"github.com/o-mishch/devstash/backend/internal/postgres"
)

func main() {
	if err := run(); err != nil {
		os.Exit(1)
	}
}

// run owns the signal-aware context and executes the root command. It exists so
// main() holds no defers: an os.Exit in main would skip them (gocritic's
// exitAfterDefer). The signal-aware context is the shutdown source of truth —
// cobra threads it into every command's Context(), so runServe observes SIGINT/
// SIGTERM without a separate signal channel; a second signal restores the default
// behaviour (immediate exit) via stop().
func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	return rootCmd().ExecuteContext(ctx)
}

// appState holds the process-wide dependencies built once in PersistentPreRunE and
// read by the subcommands. Both fields are populated before any RunE runs, so the
// subcommands close over a single *appState instead of threading double pointers.
type appState struct {
	cfg    *config.Config
	logger *slog.Logger
}

func rootCmd() *cobra.Command {
	app := &appState{}

	root := &cobra.Command{
		Use:   "api",
		Short: "DevStash Go API",
		// Running the binary with no subcommand starts the server. Cloud Run launches
		// the built binary with no arguments, so `serve` must be the default action.
		RunE: func(cmd *cobra.Command, _ []string) error {
			return runServe(cmd.Context(), app.cfg, app.logger)
		},
		SilenceUsage: true, // a runtime error from serve shouldn't dump command usage
		PersistentPreRunE: func(cmd *cobra.Command, _ []string) error {
			// `help` and the `openapi` tree are pure/offline — loading config
			// there would force every secret (DATABASE_URL, AUTH_SECRET, OAuth)
			// to be set just to emit the spec, which breaks CI contract generation.
			if cmd.Name() == "help" || skipConfigLoad(cmd) {
				return nil
			}
			// Build the logger from the raw environment before dotenv runs — the
			// same ENV check config.Load uses to gate dotenv loading — so config's
			// own best-effort warnings flow through the injected logger too.
			app.logger = logging.New(os.Getenv("ENV"))
			cfg, err := config.Load(app.logger)
			if err != nil {
				return fmt.Errorf("config: %w", err)
			}
			app.cfg = cfg
			return nil
		},
	}

	root.AddCommand(
		serveCmd(app),
		migrateCmd(app),
		openapiCmd(),
	)

	return root
}

// skipConfigLoadKey marks a command (via cobra Annotations) as offline — it runs
// without loading config/secrets. skipConfigLoadValue is the annotation's truthy value.
const (
	skipConfigLoadKey   = "skipConfigLoad"
	skipConfigLoadValue = "true"
)

// skipConfigLoad reports whether the command (or any ancestor) is annotated to
// run without loading config — used for offline commands like `openapi` that
// need no secrets. Annotations aren't inherited, so we walk up the tree.
func skipConfigLoad(cmd *cobra.Command) bool {
	for c := cmd; c != nil; c = c.Parent() {
		if c.Annotations[skipConfigLoadKey] == skipConfigLoadValue {
			return true
		}
	}
	return false
}

// ─── serve ────────────────────────────────────────────────────────────────────

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
// action, so a bare invocation with no subcommand also serves — the Dockerfile
// passes `serve` explicitly (CMD), but defaulting keeps a raw binary launch robust.
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

// ─── migrate ──────────────────────────────────────────────────────────────────

// Migration directions passed to goose — named so the subcommand names, RunE
// wiring, and the dispatch switch below stay in sync (and to satisfy goconst).
const (
	migrateUp     = "up"
	migrateDown   = "down"
	migrateStatus = "status"
)

func migrateCmd(app *appState) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "migrate",
		Short: "Database migration commands (goose)",
	}

	runMigration := func(direction string) func(*cobra.Command, []string) error {
		return func(cmd *cobra.Command, _ []string) error {
			ctx := cmd.Context()

			pool, err := postgres.Connect(ctx, app.cfg.DatabaseURL, app.logger)
			if err != nil {
				return err
			}
			defer pool.Close()

			sqlDB := stdlib.OpenDBFromPool(pool)
			goose.SetBaseFS(db.Migrations)
			goose.SetTableName("goose_db_version")

			// Path is relative to the embedded FS root (see backend/db/embed.go),
			// so migrations resolve identically wherever the binary runs.
			migrationsDir := "migrations"
			switch direction {
			case migrateUp:
				return goose.Up(sqlDB, migrationsDir)
			case migrateDown:
				return goose.Down(sqlDB, migrationsDir)
			case migrateStatus:
				return goose.Status(sqlDB, migrationsDir)
			default:
				return fmt.Errorf("unknown direction: %s", direction)
			}
		}
	}

	cmd.AddCommand(
		&cobra.Command{Use: migrateUp, Short: "Apply all pending migrations", RunE: runMigration(migrateUp)},
		&cobra.Command{Use: migrateDown, Short: "Roll back the last migration", RunE: runMigration(migrateDown)},
		&cobra.Command{Use: migrateStatus, Short: "Show migration status", RunE: runMigration(migrateStatus)},
	)

	return cmd
}

// ─── openapi ──────────────────────────────────────────────────────────────────

// openAPISpecPerm is the file mode for the emitted spec: owner read/write only
// (gosec G306 rejects world/group-writable files).
const openAPISpecPerm os.FileMode = 0o600

func openapiCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "openapi",
		Short: "OpenAPI document commands",
		// Offline: builds the spec from the route registry, needs no DB/secrets.
		Annotations: map[string]string{skipConfigLoadKey: skipConfigLoadValue},
	}

	emit := &cobra.Command{
		Use:   "emit [output-file]",
		Short: "Write the OpenAPI document to a file (default: openapi.json)",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			output := "openapi.json"
			if len(args) > 0 {
				output = args[0]
			}

			// Build a throwaway router just for the OpenAPI doc (no DB needed).
			api := newHumaAPI()
			doc := api.OpenAPI()

			b, err := json.MarshalIndent(doc, "", "  ")
			if err != nil {
				return fmt.Errorf("openapi emit: serialize: %w", err)
			}
			if err := os.WriteFile(output, b, openAPISpecPerm); err != nil {
				return fmt.Errorf("openapi emit: write %s: %w", output, err)
			}
			// This offline command skips PersistentPreRunE's config+logger setup
			// (skipConfigLoad), so no injected logger exists here — the stdlib slog
			// default is fine for a single CLI status line.
			slog.Info("openapi document written", "path", output)
			return nil
		},
	}

	cmd.AddCommand(emit)
	return cmd
}

// ─── API construction ─────────────────────────────────────────────────────────

// newRouter creates the chi router backed by a Huma API, ready to serve HTTP.
// humachi registers routes onto the chi router in-place, so returning r gives
// an http.Handler with all routes already attached.
func newRouter() http.Handler {
	r := chi.NewRouter()
	mountAPI(r)
	return r
}

// newHumaAPI creates a Huma API on a throwaway chi router. Used by openapiCmd to
// generate the spec without needing an HTTP server.
func newHumaAPI() huma.API {
	return mountAPI(chi.NewRouter())
}

// mountAPI builds the Huma API on the given chi router and registers all routes.
// Single source of truth for wiring, shared by newRouter and newHumaAPI.
func mountAPI(r chi.Router) huma.API {
	api := humachi.New(r, humaConfig())
	registerRoutes(api)
	return api
}

func humaConfig() huma.Config {
	cfg := huma.DefaultConfig("DevStash API", "0.1.0")
	cfg.Servers = []*huma.Server{
		{URL: "https://api.devstash.one", Description: "Production"},
		{URL: "http://localhost:8080", Description: "Local dev"},
	}
	// SwaggerUI at /docs — served in-process, no npm/Node dependency.
	cfg.DocsPath = "/docs"
	return cfg
}

// registerRoutes attaches all route handlers to the given API.
func registerRoutes(api huma.API) {
	registerHealthRoute(api)
}

// ─── routes ───────────────────────────────────────────────────────────────────

type healthOutput struct {
	Body struct {
		Status string `example:"ok" json:"status"`
	}
}

func registerHealthRoute(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-health",
		Method:      http.MethodGet,
		Path:        "/health",
		Summary:     "Health check",
		Tags:        []string{"system"},
	}, func(_ context.Context, _ *struct{}) (*healthOutput, error) {
		resp := &healthOutput{}
		resp.Body.Status = "ok"
		return resp, nil
	})
}
