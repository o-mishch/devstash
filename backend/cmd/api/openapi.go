package main

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"

	"github.com/spf13/cobra"
)

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
