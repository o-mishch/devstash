package middleware

import (
	"encoding/json"
	"testing"

	"github.com/danielgtaylor/huma/v2"
)

// TestProblemBodiesMatchHuma pins the hand-written net/http error bodies (Recover's
// panic 500, CrossOrigin's CSRF 403) to the exact bytes Huma emits for the same
// status+detail. Those two middlewares run OUTSIDE Huma's error machinery, so they
// can't route through huma.WriteErr and instead ship a constant string. The constant
// is correct only by convention — this test converts that convention into an
// enforced invariant: if a Huma upgrade changes the RFC 9457 envelope (adds/reorders
// a field) or someone edits a literal, the panic/CSRF paths would silently diverge
// from every other error the API returns, and this goes red instead.
func TestProblemBodiesMatchHuma(t *testing.T) {
	tests := []struct {
		name string
		got  string
		want error
	}{
		{
			name: "recover 500",
			got:  internalErrorBody,
			want: huma.Error500InternalServerError("The server encountered an unexpected condition."),
		},
		{
			name: "crossorigin 403",
			got:  forbiddenOriginBody,
			want: huma.Error403Forbidden("Cross-origin request rejected."),
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			want, err := json.Marshal(tc.want)
			if err != nil {
				t.Fatalf("marshal huma error: %v", err)
			}
			if tc.got != string(want) {
				t.Errorf("body drifted from Huma's output\n got: %s\nwant: %s", tc.got, want)
			}
		})
	}
}
