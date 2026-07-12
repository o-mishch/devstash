// Package logging configures the process-wide structured slog logger.
package logging

import (
	"log/slog"
	"os"
)

// New builds the process logger and returns it for explicit injection into the
// components that need it (config, db, handlers) — no slog.SetDefault global. In
// development it uses a human-readable TextHandler at Debug level; in production a
// JSON handler at Info level for structured ingestion (Debug in prod would be noisy
// and risks leaking request internals).
func New(env string) *slog.Logger {
	isProd := env == "production"

	level := slog.LevelDebug
	if isProd {
		level = slog.LevelInfo
	}
	opts := &slog.HandlerOptions{Level: level}

	var handler slog.Handler = slog.NewTextHandler(os.Stdout, opts)
	if isProd {
		handler = slog.NewJSONHandler(os.Stdout, opts)
	}
	// Wrap so every *Context log call automatically carries the request correlation id
	// (set by the RequestID middleware) — see ctxHandler.
	return slog.New(ctxHandler{handler})
}
