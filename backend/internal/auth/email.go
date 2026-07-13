package auth

import "context"

// SecurityEvent identifies which security-notification email to send after a
// sensitive account change. Values mirror the Next app's notification kinds.
type SecurityEvent string

// Security-notification events emailed after a sensitive account change.
// #nosec G101
const (
	SecurityPasswordReset          SecurityEvent = "password-reset"
	SecurityCredentialEmailAdded   SecurityEvent = "credential-email-added"
	SecurityCredentialEmailChanged SecurityEvent = "credential-email-changed"
	SecurityMethodLinked           SecurityEvent = "method-linked"
)

// Emailer sends the transactional auth emails. It is a consumer-defined interface
// (implemented by internal/email over the Resend SDK) so handlers test against a
// fake. Handlers build the action URLs (they own AppURL) and pass them in.
type Emailer interface {
	SendVerification(ctx context.Context, to, verifyURL string) error
	SendPasswordReset(ctx context.Context, to, resetURL string) error
	SendSecurityNotification(ctx context.Context, to string, event SecurityEvent) error
}
