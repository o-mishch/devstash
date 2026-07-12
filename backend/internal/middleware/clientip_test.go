package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/humatest"
)

func TestHostOnly(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		in   string
		want string
	}{
		{name: "host:port", in: "203.0.113.9:54321", want: "203.0.113.9"},
		{name: "ipv6 host:port", in: "[2001:db8::1]:443", want: "2001:db8::1"},
		{name: "bare host, no port", in: "203.0.113.9", want: "203.0.113.9"},
		{name: "empty", in: "", want: ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := hostOnly(tc.in); got != tc.want {
				t.Errorf("hostOnly(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

func TestRemoteIPRoundTrip(t *testing.T) {
	t.Parallel()
	if got := RemoteIP(context.Background()); got != "" {
		t.Errorf("RemoteIP(empty) = %q, want empty", got)
	}
	ctx := WithRemoteIP(context.Background(), "198.51.100.7")
	if got := RemoteIP(ctx); got != "198.51.100.7" {
		t.Errorf("RemoteIP = %q, want 198.51.100.7", got)
	}
}

func TestClientIPMiddleware(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name        string
		xff         string
		remoteAddr  string
		trustedHops int
		want        string
	}{
		{
			name:        "empty xff, falls back to remote addr",
			xff:         "",
			remoteAddr:  "203.0.113.9:54321",
			trustedHops: 0,
			want:        "203.0.113.9",
		},
		{
			name:        "empty xff, falls back to remote addr without port",
			xff:         "",
			remoteAddr:  "203.0.113.9",
			trustedHops: 0,
			want:        "203.0.113.9",
		},
		{
			name:        "single ip, trustedHops 0 uses it",
			xff:         "203.0.113.9",
			remoteAddr:  "10.0.0.1",
			trustedHops: 0,
			want:        "203.0.113.9",
		},
		{
			name:        "multiple ips, trustedHops 0 uses rightmost",
			xff:         "203.0.113.9, 198.51.100.7",
			remoteAddr:  "10.0.0.1",
			trustedHops: 0,
			want:        "198.51.100.7",
		},
		{
			name:        "multiple ips, trustedHops 1 uses second from right",
			xff:         "203.0.113.9, 198.51.100.7, 10.0.0.2",
			remoteAddr:  "10.0.0.1",
			trustedHops: 1,
			want:        "198.51.100.7",
		},
		{
			name:        "chain shorter than trustedHops, falls back to remote addr",
			xff:         "203.0.113.9",
			remoteAddr:  "10.0.0.1:1234",
			trustedHops: 2,
			want:        "10.0.0.1",
		},
		{
			name:        "chain equals trustedHops, falls back to remote addr",
			xff:         "203.0.113.9, 198.51.100.7",
			remoteAddr:  "10.0.0.1:1234",
			trustedHops: 2,
			want:        "10.0.0.1",
		},
		{
			name:        "spoofed leftmost ignored (trustedHops 0)",
			xff:         "1.2.3.4, 198.51.100.7",
			remoteAddr:  "10.0.0.1",
			trustedHops: 0,
			want:        "198.51.100.7",
		},
		{
			name:        "empty values trimmed",
			xff:         " 203.0.113.9 ,  198.51.100.7 ",
			remoteAddr:  "10.0.0.1",
			trustedHops: 0,
			want:        "198.51.100.7",
		},
		{
			name:        "only comma xff, falls back to remote addr",
			xff:         ",",
			remoteAddr:  "203.0.113.9:1234",
			trustedHops: 0,
			want:        "203.0.113.9",
		},
		{
			name:        "trusted entry with a port is normalized to the bare ip",
			xff:         "203.0.113.9:5678",
			remoteAddr:  "10.0.0.1",
			trustedHops: 0,
			want:        "203.0.113.9",
		},
		{
			name:        "non-ip trusted entry falls back to remote addr",
			xff:         "_hidden",
			remoteAddr:  "203.0.113.9:1234",
			trustedHops: 0,
			want:        "203.0.113.9",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			if tc.xff != "" {
				req.Header.Set("X-Forwarded-For", tc.xff)
			}
			req.RemoteAddr = tc.remoteAddr
			hctx := humatest.NewContext(&huma.Operation{}, req, httptest.NewRecorder())

			var got string
			ClientIP(tc.trustedHops)(hctx, func(c huma.Context) {
				got = RemoteIP(c.Context())
			})

			if got != tc.want {
				t.Errorf(
					"ClientIP(%d) with XFF %q, RemoteAddr %q = %q, want %q",
					tc.trustedHops,
					tc.xff,
					tc.remoteAddr,
					got,
					tc.want,
				)
			}
		})
	}
}
