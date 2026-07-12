package redisconn

import (
	"context"
	"log/slog"
	"testing"

	"github.com/alicebob/miniredis/v2"
)

func discardLogger() *slog.Logger { return slog.New(slog.DiscardHandler) }

func TestConnectSuccess(t *testing.T) {
	t.Parallel()
	mr := miniredis.RunT(t)

	client, err := Connect(context.Background(), "redis://"+mr.Addr(), discardLogger())
	if err != nil {
		t.Fatalf("Connect() error = %v, want nil", err)
	}
	t.Cleanup(func() { _ = client.Close() })

	if err := client.Ping(context.Background()).Err(); err != nil {
		t.Errorf("ping after connect = %v, want nil", err)
	}
}

func TestConnectBadURL(t *testing.T) {
	t.Parallel()
	if _, err := Connect(context.Background(), "://not-a-url", discardLogger()); err == nil {
		t.Fatal("Connect(bad url) error = nil, want a parse error")
	}
}

func TestConnectPingFails(t *testing.T) {
	t.Parallel()
	mr := miniredis.RunT(t)
	addr := mr.Addr()
	mr.Close() // server gone → the boot ping must fail fast

	if _, err := Connect(context.Background(), "redis://"+addr, discardLogger()); err == nil {
		t.Fatal("Connect(dead server) error = nil, want a ping error")
	}
}
