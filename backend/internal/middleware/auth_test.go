package middleware

import (
	"context"
	"testing"

	"github.com/danielgtaylor/huma/v2"

	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
)

func TestRequiresSession(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		op   *huma.Operation
		want bool
	}{
		{name: "no security", op: &huma.Operation{}, want: false},
		{
			name: "session scheme required",
			op:   &huma.Operation{Security: []map[string][]string{{SessionScheme: {}}}},
			want: true,
		},
		{
			name: "unrelated scheme only",
			op:   &huma.Operation{Security: []map[string][]string{{"oauth": {"read"}}}},
			want: false,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := requiresSession(tc.op); got != tc.want {
				t.Errorf("requiresSession() = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestCurrentUserAccessors(t *testing.T) {
	t.Parallel()

	t.Run("absent", func(t *testing.T) {
		t.Parallel()
		ctx := context.Background()
		if id, ok := CurrentUserID(ctx); ok || id != "" {
			t.Errorf("CurrentUserID(empty) = %q, %v; want \"\", false", id, ok)
		}
		if _, ok := CurrentUser(ctx); ok {
			t.Error("CurrentUser(empty) ok = true, want false")
		}
	})

	t.Run("present", func(t *testing.T) {
		t.Parallel()
		user := sqlcdb.User{ID: "u1", Email: "u@example.com"}
		ctx := context.WithValue(context.Background(), userIDKey, "u1")
		ctx = context.WithValue(ctx, userKey, user)

		id, ok := CurrentUserID(ctx)
		if !ok || id != "u1" {
			t.Errorf("CurrentUserID = %q, %v; want u1, true", id, ok)
		}
		got, ok := CurrentUser(ctx)
		if !ok || got.ID != "u1" {
			t.Errorf("CurrentUser = %+v, %v; want u1, true", got, ok)
		}
	})

	t.Run("empty id is not authenticated", func(t *testing.T) {
		t.Parallel()
		ctx := context.WithValue(context.Background(), userIDKey, "")
		if _, ok := CurrentUserID(ctx); ok {
			t.Error("CurrentUserID(empty string) ok = true, want false")
		}
	})
}

func TestDeref(t *testing.T) {
	t.Parallel()
	if got := deref(nil); got != "" {
		t.Errorf("deref(nil) = %q, want \"\"", got)
	}
	s := "hello"
	if got := deref(&s); got != "hello" {
		t.Errorf("deref(&s) = %q, want hello", got)
	}
}
