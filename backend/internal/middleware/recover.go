package middleware

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"runtime/debug"

	"github.com/o-mishch/devstash/backend/internal/reqid"
)

// internalErrorBody is the RFC 9457 problem document returned when Recover traps a
// panic. Written directly (this middleware runs outside Huma's error machinery), but
// the shape matches Huma's native errors and the CrossOrigin layer, so clients see a
// uniform error envelope even on the panic path.
const internalErrorBody = `{"title":"Internal Server Error","status":500,"detail":"The server encountered an unexpected condition."}`

// Recover is a net/http middleware that turns a handler panic into a logged, clean
// RFC 9457 500 instead of a dropped connection. Huma v2 does not recover operation
// panics (only response transforms are guarded), so without this a panic escapes to
// net/http, which closes the connection with no response and only a bare stderr trace.
//
// Preferred over chi's middleware.Recoverer — which writes an empty 500 body and dumps
// an ANSI-coloured stack straight to os.Stderr — because both clash with this service's
// RFC 9457 error shape and structured (JSON-in-prod) slog logging. Here the stack is a
// structured slog field and the id from RequestID ties the log line to the response.
//
// http.ErrAbortHandler is re-panicked, not trapped: it is the sentinel a handler raises
// to abort the response on purpose, and net/http suppresses its log — swallowing it
// here would corrupt that contract.
func Recover(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func(ctx context.Context) {
				rvr := recover()
				if rvr == nil {
					return
				}
				if err, ok := rvr.(error); ok && errors.Is(err, http.ErrAbortHandler) {
					panic(rvr)
				}
				logger.ErrorContext(ctx, "recovered from panic",
					"panic", rvr,
					"stack", string(debug.Stack()),
					"method", r.Method,
					"path", r.URL.Path,
					"requestId", reqid.From(ctx),
				)
				writeProblem(w, http.StatusInternalServerError, internalErrorBody)
			}(r.Context())
			next.ServeHTTP(w, r)
		})
	}
}
