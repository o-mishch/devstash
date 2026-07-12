package reqid

import (
	"context"
	"testing"
)

// TestWithFromRoundTrip covers the happy path (a stored id reads back) and the absent
// path (a bare context yields "").
func TestWithFromRoundTrip(t *testing.T) {
	t.Parallel()

	if got := From(context.Background()); got != "" {
		t.Errorf("From(empty) = %q, want \"\"", got)
	}

	ctx := With(context.Background(), "abc123")
	if got := From(ctx); got != "abc123" {
		t.Errorf("From(With(...)) = %q, want %q", got, "abc123")
	}
}
