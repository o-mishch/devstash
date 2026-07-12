package email

import (
	_ "embed"
	"strings"
)

// The three templates below are verbatim ports of src/lib/emails/*.html — same
// {{PLACEHOLDER}} shape, same branded card layout — so Go and Next.js emails are
// visually identical rather than independently maintained.

//go:embed templates/base-template.html
var baseTemplateHTML string

//go:embed templates/link-email.html
var linkEmailHTML string

//go:embed templates/security-notification.html
var securityNotificationHTML string

// buildEmailTemplate wraps bodyHTML in the shared branded card layout. Mirrors
// template-builder.ts's buildEmailTemplate exactly.
func buildEmailTemplate(title, bodyHTML string) string {
	r := strings.NewReplacer("{{TITLE}}", title, "{{BODY}}", bodyHTML)
	return r.Replace(baseTemplateHTML)
}

// linkEmailCopy is the per-flow copy for a token-link email (verify / reset /
// confirm). Mirrors the Next app's TokenLinkEmailOptions, minus path/token: the Go
// Emailer interface receives the already-built URL from its caller (auth.actionURL),
// unlike Next's sendTokenLinkEmail which builds it from a path+token pair itself.
type linkEmailCopy struct {
	subject    string
	heading    string
	intro      string
	cta        string
	disclaimer string
}

// renderLinkEmail fills link-email.html for the given copy and URL, then wraps it
// in the base template. Mirrors sendTokenLinkEmail's body construction.
func renderLinkEmail(linkCopy linkEmailCopy, url string) string {
	r := strings.NewReplacer(
		"{{HEADING}}", linkCopy.heading,
		"{{INTRO}}", linkCopy.intro,
		"{{URL}}", url,
		"{{CTA}}", linkCopy.cta,
		"{{DISCLAIMER}}", linkCopy.disclaimer,
	)
	return buildEmailTemplate(linkCopy.subject, r.Replace(linkEmailHTML))
}

// renderSecurityEmail fills security-notification.html and wraps it in the base
// template. Mirrors security-notification.ts's body construction.
func renderSecurityEmail(subject, heading, message, settingsURL string) string {
	r := strings.NewReplacer(
		"{{HEADING}}", heading,
		"{{MESSAGE}}", message,
		"{{SETTINGS_URL}}", settingsURL,
	)
	return buildEmailTemplate(subject, r.Replace(securityNotificationHTML))
}
