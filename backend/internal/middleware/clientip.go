package middleware

import (
	"context"
	"net"
	"slices"
	"strings"

	"github.com/danielgtaylor/huma/v2"
)

// ClientIP is a Huma middleware that stashes the resolved client's IP into the
// request context. It reads the X-Forwarded-For header and trusts it up to the
// configured trustedHops from the right, falling back to the host portion of the
// request RemoteAddr, and finally to "127.0.0.1". Handlers read the resolved IP
// via RemoteIP as the single source of truth for rate limiting and auditing.
func ClientIP(trustedHops int) func(huma.Context, func(huma.Context)) {
	return func(ctx huma.Context, next func(huma.Context)) {
		xff := ctx.Header("X-Forwarded-For")
		var ip string
		if xip := clientIPFromXFF(xff, trustedHops); xip != "" {
			ip = xip
		} else {
			ip = hostOnly(ctx.RemoteAddr())
		}
		if ip == "" {
			ip = "127.0.0.1"
		}
		next(huma.WithValue(ctx, remoteAddrKey, ip))
	}
}

// RemoteIP returns the connecting client's IP stashed by ClientIP, or "" if absent.
func RemoteIP(ctx context.Context) string {
	ip, _ := ctx.Value(remoteAddrKey).(string)
	return ip
}

// WithRemoteIP returns a copy of ctx carrying ip as the connecting client's IP,
// readable via RemoteIP. ClientIP stashes it on the per-request huma.Context; this is
// the plain-context seam handlers (and tests) use to set or inject it directly.
func WithRemoteIP(ctx context.Context, ip string) context.Context {
	return context.WithValue(ctx, remoteAddrKey, ip)
}

// hostOnly strips the port from a host:port RemoteAddr, returning the input as-is
// when it carries no port (already a bare host).
func hostOnly(remoteAddr string) string {
	if host, _, err := net.SplitHostPort(remoteAddr); err == nil {
		return host
	}
	return remoteAddr
}

// clientIPFromXFF returns the trustworthy client IP from an X-Forwarded-For value,
// given the number of trusted reverse-proxy hops (trustedHops) in front of the
// service, or "" when the header carries no usable entry.
//
// XFF is a left-to-right list: "<client-supplied…>, <realClient>, <proxy1>, …". Only
// the entries the trusted infrastructure appended — on the RIGHT — are reliable, so we
// index from the right: the real client sits trustedHops positions left of the
// rightmost entry.
//
// If the XFF chain has fewer entries than or equal to trustedHops, we return "" to fall
// back to the RemoteAddr (which is direct and trustworthy).
func clientIPFromXFF(xff string, trustedHops int) string {
	parts := forwardedForParts(xff)
	if len(parts) == 0 {
		return ""
	}
	if len(parts) <= trustedHops {
		return ""
	}
	idx := len(parts) - 1 - trustedHops
	// Normalize + validate the trusted entry: strip any host:port an upstream appended
	// and confirm it parses as an IP, so the rate-limit/audit key matches the RemoteAddr
	// fallback's form. A non-IP entry (an RFC 7239 obfuscated identifier, or garbage)
	// yields "" so the caller falls back to RemoteAddr rather than keying on junk.
	entry := hostOnly(parts[idx])
	if net.ParseIP(entry) == nil {
		return ""
	}
	return entry
}

// forwardedForParts splits an X-Forwarded-For value into trimmed, non-empty entries,
// preserving left-to-right order.
func forwardedForParts(xff string) []string {
	if xff == "" {
		return nil
	}
	parts := strings.Split(xff, ",")
	// Classic loop (allowed case 2: index writeback) — trim each entry in place; a
	// value range yields copies and no slices helper expresses an in-place map.
	for i := range parts {
		parts[i] = strings.TrimSpace(parts[i])
	}
	return slices.DeleteFunc(parts, func(s string) bool { return s == "" })
}
