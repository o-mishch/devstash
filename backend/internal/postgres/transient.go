package postgres

import (
	"context"
	"errors"
	"net"

	"github.com/jackc/pgx/v5/pgconn"
)

// IsTransient reports whether err is a transient database failure — a connectivity
// or timeout blip rather than a logical error. The auth middleware uses this to
// PRESERVE a session across a momentary DB outage instead of forcing re-login. It
// covers the Next app's isTransientDatabaseError set (P1001/P1002/P1008/P1017/P2024:
// unreachable, timed out, connection closed, pool-acquire timeout) and deliberately
// widens it to the whole 08xxx connection class: against Neon's scale-to-zero pooled
// endpoint even a "connection rejected" (08004/08001) is almost always a cold-start or
// connection-limit blip that clears on retry, so treating it as transient (preserve the
// session, degrade the handler to 503) is the safer bias than forcing a re-login. The
// worst case — a genuinely permanent rejection — only extends the preserve window for
// the outage's duration; logical errors (unique violations, etc.) are never in 08xxx.
func IsTransient(err error) bool {
	if err == nil {
		return false
	}
	// Pool-acquire and query timeouts surface as a deadline on the caller context.
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	// Dial/read/write timeouts from the network layer.
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return true
	}
	// pgx could not establish the connection at all (host down, TLS, DNS).
	var connErr *pgconn.ConnectError
	if errors.As(err, &connErr) {
		return true
	}
	// Server-reported connection-class SQLSTATEs (08xxx) and shutdown/quiescing states.
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "08000", "08001", "08003", "08004", "08006", "08007", "57P01", "57P03":
			return true
		}
	}
	return false
}
