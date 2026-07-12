package middleware

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestRecoverTrapsPanic asserts a handler panic becomes a logged RFC 9457 500 with the
// problem+json content type and body, rather than escaping to net/http.
func TestRecoverTrapsPanic(t *testing.T) {
	t.Parallel()

	var buf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&buf, nil))
	panicky := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("boom")
	})

	rr := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/x", nil)
	Recover(logger)(panicky).ServeHTTP(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want %d", rr.Code, http.StatusInternalServerError)
	}
	if ct := rr.Header().Get("Content-Type"); ct != "application/problem+json" {
		t.Errorf("Content-Type = %q, want application/problem+json", ct)
	}
	if body := rr.Body.String(); body != internalErrorBody {
		t.Errorf("body = %q, want %q", body, internalErrorBody)
	}
	if logged := buf.String(); !strings.Contains(logged, "recovered from panic") || !strings.Contains(logged, "boom") {
		t.Errorf("panic not logged with detail; got %q", logged)
	}
}

// TestRecoverPassesThrough asserts a non-panicking handler is left untouched.
func TestRecoverPassesThrough(t *testing.T) {
	t.Parallel()

	reached := false
	rr := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	Recover(discardLogger())(okHandler(&reached)).ServeHTTP(rr, req)

	if !reached {
		t.Error("downstream handler was not reached")
	}
	if rr.Code != http.StatusNoContent {
		t.Errorf("status = %d, want %d", rr.Code, http.StatusNoContent)
	}
}

// TestRecoverReraisesAbortHandler asserts http.ErrAbortHandler is NOT trapped — it is
// the sentinel a handler raises to abort the response on purpose, so Recover must let it
// propagate (net/http suppresses its log and drops the connection).
func TestRecoverReraisesAbortHandler(t *testing.T) {
	t.Parallel()

	defer func() {
		rvr := recover()
		if err, ok := rvr.(error); !ok || !errors.Is(err, http.ErrAbortHandler) {
			t.Errorf("recovered %v, want http.ErrAbortHandler to propagate", rvr)
		}
	}()

	aborts := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic(http.ErrAbortHandler)
	})
	rr := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	Recover(discardLogger())(aborts).ServeHTTP(rr, req)
	t.Fatal("ServeHTTP returned; expected http.ErrAbortHandler to re-panic")
}
