package email

import (
	"context"

	"github.com/o-mishch/devstash/backend/internal/auth"
)

// Noop is an auth.Emailer that drops every message. Used when no Resend API key is
// configured (local dev, verification disabled) so best-effort notification sends
// never error.
type Noop struct{}

var _ auth.Emailer = Noop{}

// SendVerification drops the message.
func (Noop) SendVerification(context.Context, string, string) error { return nil }

// SendPasswordReset drops the message.
func (Noop) SendPasswordReset(context.Context, string, string) error { return nil }

// SendSecurityNotification drops the message.
func (Noop) SendSecurityNotification(context.Context, string, auth.SecurityEvent) error { return nil }
