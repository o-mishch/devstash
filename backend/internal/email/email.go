// Package email sends the transactional auth emails over the Resend SDK. It
// implements auth.Emailer; the auth handlers depend on that interface, not on
// Resend directly, so tests use a fake and this package is the one external seam.
// Email bodies reuse the Next app's src/lib/emails templates (see templates.go) so
// both stacks send visually identical, branded emails rather than diverging designs.
package email

import (
	"context"
	"fmt"
	"strings"

	"github.com/resend/resend-go/v2"

	"github.com/o-mishch/devstash/backend/internal/auth"
)

// Client is the Resend-backed auth.Emailer.
type Client struct {
	resend *resend.Client
	from   string
	appURL string
}

// New builds a Client. from is the verified sender (EMAIL_FROM); appURL is the SPA
// origin, used to build the security-notification "review your account" link.
func New(apiKey, from, appURL string) *Client {
	return &Client{resend: resend.NewClient(apiKey), from: from, appURL: appURL}
}

// Compile-time assertion that Client satisfies the consumer's interface.
var _ auth.Emailer = (*Client)(nil)

// verificationCopy mirrors the Next app's verification.ts copy exactly (parity,
// not just equivalent behavior — same heading/intro/cta/disclaimer text).
func verificationCopy() linkEmailCopy {
	return linkEmailCopy{
		subject:    "Verify your DevStash email",
		heading:    "Verify your email",
		intro:      "Click the button below to verify your DevStash account. This link expires in <strong>24 hours</strong>.",
		cta:        "Verify email",
		disclaimer: "If you didn't create a DevStash account, you can safely ignore this email.",
	}
}

// passwordResetCopy mirrors the Next app's password-reset.ts copy exactly.
func passwordResetCopy() linkEmailCopy {
	return linkEmailCopy{
		subject:    "Reset your DevStash password",
		heading:    "Reset your password",
		intro:      "Click the button below to reset your DevStash password. This link expires in <strong>1 hour</strong>.",
		cta:        "Reset password",
		disclaimer: "If you didn't request a password reset, you can safely ignore this email.",
	}
}

// SendVerification emails the account-verification link.
func (c *Client) SendVerification(ctx context.Context, to, verifyURL string) error {
	linkCopy := verificationCopy()
	return c.send(ctx, to, linkCopy.subject, renderLinkEmail(linkCopy, verifyURL))
}

// SendPasswordReset emails the password-reset link.
func (c *Client) SendPasswordReset(ctx context.Context, to, resetURL string) error {
	linkCopy := passwordResetCopy()
	return c.send(ctx, to, linkCopy.subject, renderLinkEmail(linkCopy, resetURL))
}

// SendSecurityNotification emails a security-change notice.
func (c *Client) SendSecurityNotification(ctx context.Context, to string, event auth.SecurityEvent) error {
	subject, heading, message := securityCopy(event)
	settingsURL := strings.TrimRight(c.appURL, "/") + "/profile"
	return c.send(ctx, to, subject, renderSecurityEmail(subject, heading, message, settingsURL))
}

// send dispatches one email through Resend.
func (c *Client) send(ctx context.Context, to, subject, htmlBody string) error {
	_, err := c.resend.Emails.SendWithContext(ctx, &resend.SendEmailRequest{
		From:    c.from,
		To:      []string{to},
		Subject: subject,
		Html:    htmlBody,
	})
	if err != nil {
		return fmt.Errorf("email: send %q: %w", subject, err)
	}
	return nil
}

// securityCopy returns the subject, heading, and message for a security-
// notification event. Mirrors the Next app's security-notification.ts EVENT_COPY
// map exactly, restricted to the three events the Go backend currently emits
// (OAuth linking/unlinking events land with OAuth support).
func securityCopy(event auth.SecurityEvent) (string, string, string) {
	switch event {
	case auth.SecurityPasswordReset:
		return "Your DevStash password was reset",
			"Password reset",
			"The password on your DevStash account was just reset."
	case auth.SecurityCredentialEmailAdded:
		return "A new sign-in email was added to your DevStash account",
			"Sign-in email added",
			"A new email-and-password sign-in was just confirmed for your DevStash account. " +
				"You can now sign in with that email address in addition to your existing sign-in methods."
	case auth.SecurityCredentialEmailChanged:
		return "Your DevStash sign-in email was changed",
			"Sign-in email changed",
			"The email you use for email-and-password sign-in on your DevStash account was just changed. " +
				"Your password and your other sign-in methods are unchanged."
	default:
		return "DevStash security notice", "Security notice", "There was a security-relevant change to your DevStash account."
	}
}
