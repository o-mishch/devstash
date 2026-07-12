package logging

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"

	"github.com/o-mishch/devstash/backend/internal/reqid"
)

// TestCtxHandlerInjectsRequestID asserts the request id on the context lands on the log
// line, and is omitted when absent.
func TestCtxHandlerInjectsRequestID(t *testing.T) {
	t.Parallel()

	var buf bytes.Buffer
	logger := slog.New(ctxHandler{slog.NewTextHandler(&buf, nil)})

	logger.InfoContext(reqid.With(context.Background(), "req-42"), "with id")
	logger.InfoContext(context.Background(), "no id")

	out := buf.String()
	if !strings.Contains(out, "requestId=req-42") {
		t.Errorf("expected requestId on the first line; got %q", out)
	}
	// The second line must not carry a requestId attribute at all.
	for line := range strings.SplitSeq(out, "\n") {
		if strings.Contains(line, "no id") && strings.Contains(line, "requestId") {
			t.Errorf("second line should have no requestId; got %q", line)
		}
	}
}

// TestCtxHandlerSurvivesWith asserts the wrapper is preserved through logger.With — a
// derived logger must still inject the request id, not silently drop it.
func TestCtxHandlerSurvivesWith(t *testing.T) {
	t.Parallel()

	var buf bytes.Buffer
	logger := slog.New(ctxHandler{slog.NewTextHandler(&buf, nil)}).With("component", "auth")

	logger.InfoContext(reqid.With(context.Background(), "req-7"), "derived")

	if out := buf.String(); !strings.Contains(out, "requestId=req-7") || !strings.Contains(out, "component=auth") {
		t.Errorf("derived logger lost injection or attrs; got %q", out)
	}
}
