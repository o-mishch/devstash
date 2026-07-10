package logging

import (
	"context"
	"log/slog"
	"testing"
)

// TestNewLevelAndHandlerPerEnv asserts New wires the right handler type and level
// per environment: production → JSON at Info (Debug suppressed), everything else →
// Text at Debug. Level is checked through Enabled (behaviour), handler type through
// a type assertion (the ingestion format is a real contract for prod log parsing).
func TestNewLevelAndHandlerPerEnv(t *testing.T) {
	ctx := context.Background()

	cases := []struct {
		name     string
		env      string
		debugOn  bool
		wantJSON bool
	}{
		{name: "production is JSON at Info", env: "production", debugOn: false, wantJSON: true},
		{name: "development is Text at Debug", env: "development", debugOn: true, wantJSON: false},
		{name: "unknown env defaults to dev behaviour", env: "", debugOn: true, wantJSON: false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			logger := New(tc.env)

			if got := logger.Enabled(ctx, slog.LevelDebug); got != tc.debugOn {
				t.Errorf("Enabled(Debug) = %v, want %v", got, tc.debugOn)
			}
			// Info must always be enabled in both configurations.
			if !logger.Enabled(ctx, slog.LevelInfo) {
				t.Error("Enabled(Info) = false, want true")
			}

			switch h := logger.Handler().(type) {
			case *slog.JSONHandler:
				if !tc.wantJSON {
					t.Errorf("handler = *slog.JSONHandler, want *slog.TextHandler")
				}
			case *slog.TextHandler:
				if tc.wantJSON {
					t.Errorf("handler = *slog.TextHandler, want *slog.JSONHandler")
				}
			default:
				t.Errorf("handler = %T, want *slog.JSONHandler or *slog.TextHandler", h)
			}
		})
	}
}
