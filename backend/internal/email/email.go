// Package email sends the transactional auth emails over the Resend SDK. It
// implements auth.Emailer; the auth handlers depend on that interface, not on
// Resend directly, so tests use a fake and this package is the one external seam.
package email

import (
	"context"
	"fmt"
	"html"

	"github.com/resend/resend-go/v2"

	"github.com/o-mishch/devstash/backend/internal/auth"
)

// Client is the Resend-backed auth.Emailer.
type Client struct {
	resend *resend.Client
	from   string
}

// New builds a Client. from is the verified sender (EMAIL_FROM).
func New(apiKey, from string) *Client {
	return &Client{resend: resend.NewClient(apiKey), from: from}
}

// Compile-time assertion that Client satisfies the consumer's interface.
var _ auth.Emailer = (*Client)(nil)

// SendVerification emails the account-verification link.
func (c *Client) SendVerification(ctx context.Context, to, verifyURL string) error {
	return c.send(
		ctx,
		to,
		"Verify your DevStash email",
		button(
			"Confirm your email",
			"Verify your email address to finish setting up your DevStash account.",
			verifyURL,
		),
	)
}

// SendPasswordReset emails the password-reset link.
func (c *Client) SendPasswordReset(ctx context.Context, to, resetURL string) error {
	return c.send(
		ctx,
		to,
		"Reset your DevStash password",
		button(
			"Reset password",
			"We received a request to reset your DevStash password. This link expires in 1 hour.",
			resetURL,
		),
	)
}

// SendSecurityNotification emails a security-change notice.
func (c *Client) SendSecurityNotification(ctx context.Context, to string, event auth.SecurityEvent) error {
	subject, body := securityCopy(event)
	return c.send(ctx, to, subject, paragraph(body))
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

// securityCopy returns the subject and body for a security-notification event.
func securityCopy(event auth.SecurityEvent) (string, string) {
	switch event {
	case auth.SecurityPasswordReset:
		return "Your DevStash password was changed", "Your DevStash password was just changed. If this wasn't you, reset it immediately."
	case auth.SecurityCredentialEmailAdded:
		return "Email & Password sign-in was added", "Email & Password sign-in was added to your DevStash account. If this wasn't you, secure your account."
	case auth.SecurityCredentialEmailChanged:
		return "Your DevStash sign-in email was changed", "Your DevStash sign-in email was changed. If this wasn't you, contact support."
	default:
		return "DevStash security notice", "There was a security-relevant change to your DevStash account."
	}
}

// button renders a minimal HTML email with a call-to-action link.
func button(action, intro, url string) string {
	return fmt.Sprintf(
		`<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto">`+
			`<p>%s</p><p><a href="%s" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;border-radius:6px;text-decoration:none">%s</a></p>`+
			`<p style="color:#666;font-size:12px">If the button doesn't work, paste this link into your browser:<br>%s</p></div>`,
		html.EscapeString(intro), html.EscapeString(url), html.EscapeString(action), html.EscapeString(url),
	)
}

// paragraph renders a minimal HTML email body with a single message.
func paragraph(body string) string {
	return fmt.Sprintf(
		`<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto"><p>%s</p></div>`,
		html.EscapeString(body),
	)
}
