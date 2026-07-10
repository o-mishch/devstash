package main

import (
	"fmt"

	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/spf13/cobra"

	"github.com/o-mishch/devstash/backend/db"
	"github.com/o-mishch/devstash/backend/internal/postgres"
)

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
