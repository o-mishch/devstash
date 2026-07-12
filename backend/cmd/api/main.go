// Command api is the DevStash Go API server: `serve`, `migrate`, and `openapi`.
// The CLI wiring lives here; each subcommand and the HTTP/API construction sit in
// their own files in this package (serve.go, migrate.go, openapi.go, router.go).
package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/spf13/cobra"

	"github.com/o-mishch/devstash/backend/internal/config"
	"github.com/o-mishch/devstash/backend/internal/logging"
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
			// there would force the required secrets (DATABASE_URL, REDIS_URL) to
			// be set just to emit the spec, which breaks CI contract generation.
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
