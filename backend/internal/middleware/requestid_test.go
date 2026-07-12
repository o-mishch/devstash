package middleware

import (
	"context"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/o-mishch/devstash/backend/internal/reqid"
)

// TestRequestIDSetsHeaderAndContext asserts RequestID stamps a 16-byte hex id on both
// the response header and the request context, and that the two agree.
func TestRequestIDSetsHeaderAndContext(t *testing.T) {
	t.Parallel()

	var ctxID string
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctxID = reqid.From(r.Context())
		w.WriteHeader(http.StatusNoContent)
	})

	rr := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	RequestID(next).ServeHTTP(rr, req)

	headerID := rr.Header().Get(RequestIDHeader)
	if headerID == "" {
		t.Fatal("X-Request-Id header not set")
	}
	if headerID != ctxID {
		t.Errorf("context id %q != header id %q", ctxID, headerID)
	}
	// 16 random bytes -> 32 hex chars, and it must actually decode as hex.
	if _, err := hex.DecodeString(headerID); err != nil || len(headerID) != 32 {
		t.Errorf("id %q is not 32 hex chars: len=%d err=%v", headerID, len(headerID), err)
	}
}

// TestRequestIDIsFreshPerRequest asserts the id is generated per request (not reused)
// and that an inbound X-Request-Id is ignored — the server always mints its own, so a
// forged value can't be reflected into logs.
func TestRequestIDIsFreshPerRequest(t *testing.T) {
	t.Parallel()

	handler := RequestID(okHandler(new(bool)))

	first := httptest.NewRecorder()
	handler.ServeHTTP(first, httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil))

	second := httptest.NewRecorder()
	forged := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	forged.Header.Set(RequestIDHeader, "client-supplied-value")
	handler.ServeHTTP(second, forged)

	id1, id2 := first.Header().Get(RequestIDHeader), second.Header().Get(RequestIDHeader)
	if id1 == id2 {
		t.Errorf("expected distinct ids per request, got %q twice", id1)
	}
	if id2 == "client-supplied-value" {
		t.Error("inbound X-Request-Id was reflected; it must be ignored")
	}
}
