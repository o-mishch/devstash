package logging

import (
	"context"
	"log/slog"

	"github.com/o-mishch/devstash/backend/internal/reqid"
)

// ctxHandler wraps a slog.Handler to fold the per-request correlation id (set by the
// RequestID middleware, carried on the context via reqid) into every record as a
// "requestId" attribute. This is what makes request correlation real across the app:
// every *Context log call already threads ctx, so none of them has to add the id by
// hand — a plain slog.Info without a ctx simply omits it.
type ctxHandler struct {
	slog.Handler
}

// Handle stamps the request id (when present) onto the record before delegating.
func (h ctxHandler) Handle(ctx context.Context, r slog.Record) error {
	if id := reqid.From(ctx); id != "" {
		r.AddAttrs(slog.String("requestId", id))
	}
	return h.Handler.Handle(ctx, r)
}

// WithAttrs re-wraps so the id injection survives logger.With(...). Without this the
// embedded handler's WithAttrs would return the bare underlying handler, silently
// dropping the wrapper on every derived logger.
func (h ctxHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return ctxHandler{h.Handler.WithAttrs(attrs)}
}

// WithGroup re-wraps for the same reason as WithAttrs (derived loggers via WithGroup).
func (h ctxHandler) WithGroup(name string) slog.Handler {
	return ctxHandler{h.Handler.WithGroup(name)}
}
