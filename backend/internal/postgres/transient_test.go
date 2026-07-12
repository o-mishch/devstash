package postgres

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

// timeoutError is a net.Error whose Timeout() is true.
type timeoutError struct{}

func (timeoutError) Error() string   { return "i/o timeout" }
func (timeoutError) Timeout() bool   { return true }
func (timeoutError) Temporary() bool { return true }

func TestIsTransient(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{name: "nil", err: nil, want: false},
		{name: "context deadline", err: context.DeadlineExceeded, want: true},
		{name: "wrapped context deadline", err: fmt.Errorf("query: %w", context.DeadlineExceeded), want: true},
		{name: "net timeout", err: timeoutError{}, want: true},
		{name: "pg connect error", err: &pgconn.ConnectError{}, want: true},
		{name: "pg connection-class sqlstate", err: &pgconn.PgError{Code: "08006"}, want: true},
		{name: "pg admin shutdown", err: &pgconn.PgError{Code: "57P01"}, want: true},
		{name: "pg unique violation is not transient", err: &pgconn.PgError{Code: "23505"}, want: false},
		{name: "plain error", err: errors.New("boom"), want: false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := IsTransient(tc.err); got != tc.want {
				t.Errorf("IsTransient(%v) = %v, want %v", tc.err, got, tc.want)
			}
		})
	}
}
