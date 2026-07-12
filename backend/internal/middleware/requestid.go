package middleware

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"

	"github.com/o-mishch/devstash/backend/internal/reqid"
)

// RequestIDHeader carries the per-request correlation id on the response (and is the
// conventional inbound name too, though we do not trust an inbound value — see RequestID).
const RequestIDHeader = "X-Request-Id"

// RequestID is a net/http middleware that assigns every request a fresh random
// correlation id, stashes it in the request context (read via reqid.From), and echoes
// it on the response as X-Request-Id. It replaces chi's middleware.RequestID: a
// ~20-line stdlib equivalent that lets the service drop the go-chi dependency and run
// Huma on the stdlib net/http.ServeMux (humago) instead.
//
// The id is generated server-side rather than propagated from an inbound header, so
// the value is always bounded, well-formed, and safe to log — an attacker cannot inject
// newlines or arbitrary content into the log line via a forged X-Request-Id.
//
// Wired as the OUTERMOST layer so the id is present in the context for every downstream
// middleware and handler; the logging handler then reads it (via reqid.From) onto every
// structured log line, and the panic Recover log includes it too.
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := newRequestID()
		w.Header().Set(RequestIDHeader, id)
		next.ServeHTTP(w, r.WithContext(reqid.With(r.Context(), id)))
	})
}

// newRequestID returns 16 random bytes as hex. crypto/rand.Read never fails on the
// supported platforms (it panics internally on a broken RNG since Go 1.24), so the
// returned error is effectively unreachable; a panic here would only fire if the
// system entropy source were catastrophically broken, which is fatal anyway.
func newRequestID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic("middleware: system RNG failed: " + err.Error())
	}
	return hex.EncodeToString(b[:])
}
