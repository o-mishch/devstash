// Package config loads the environment configuration shared with the Next.js app.
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/caarlos0/env/v11"
	"github.com/joho/godotenv"
)

// Config holds all configuration values loaded from environment variables.
// Variable names match the existing .env keys exactly — no renames.
type Config struct {
	// Server
	Port string `env:"PORT" envDefault:"8080"`
	Env  string `env:"ENV"  envDefault:"development"`

	// Database — same DATABASE_URL used by Neon/Prisma
	DatabaseURL string `env:"DATABASE_URL,required"`

	// Auth. AUTH_SECRET is NOT `required`: the Go service reads no cookie it needs to
	// decrypt (the legacy NextAuth JWE decode was dropped in favour of a forced
	// re-login), so nothing consumes it today. Kept as an optional field so it's
	// documented and available if a future flow (e.g. signed OAuth `state`) needs it —
	// requiring an unread secret would only block boot for no benefit.
	AuthSecret string `env:"AUTH_SECRET"`

	// OAuth — GitHub / Google (NextAuth v5 auto-inferred names; shared with the app).
	// NOT `required`: OAuth start/callback isn't implemented yet, so requiring these
	// would refuse to boot for secrets no code reads. Flip to `,required` when oauth.go
	// lands and the flows actually consume them.
	GitHubClientID     string `env:"AUTH_GITHUB_ID"`
	GitHubClientSecret string `env:"AUTH_GITHUB_SECRET"`
	GoogleClientID     string `env:"AUTH_GOOGLE_ID"`
	GoogleClientSecret string `env:"AUTH_GOOGLE_SECRET"`

	// Redis — go-redis TCP/TLS URL (NOT the Next app's UPSTASH_REDIS_REST_URL, which
	// is the HTTP REST endpoint go-redis can't speak). "rediss://…" (Upstash, prod)
	// enables TLS; "redis://…" (native Redis — local/sandbox/testcontainers) doesn't.
	// Required: Phase 1 auth (sessions, rate-limit, one-time tokens) hard-depends on it.
	RedisURL string `env:"REDIS_URL,required"`

	// S3-compatible object storage (AWS S3 / Cloudflare R2 — same S3_* keys, region "auto" for R2)
	S3AccessKeyID     string `env:"S3_ACCESS_KEY_ID"`
	S3SecretAccessKey string `env:"S3_SECRET_ACCESS_KEY"`
	S3Endpoint        string `env:"S3_ENDPOINT"`
	S3Bucket          string `env:"S3_BUCKET"`
	S3Region          string `env:"S3_REGION"            envDefault:"auto"`

	// Email (Resend)
	ResendAPIKey string `env:"RESEND_API_KEY"`
	EmailFrom    string `env:"EMAIL_FROM"`

	// Stripe
	StripeSecretKey     string `env:"STRIPE_SECRET_KEY"`
	StripeWebhookSecret string `env:"STRIPE_WEBHOOK_SECRET"`

	// OpenAI
	OpenAIAPIKey string `env:"OPENAI_API_KEY"`

	// App
	AppURL string `env:"NEXT_PUBLIC_APP_URL" envDefault:"http://localhost:3000"`

	// TrustedProxyDepth is how many trusted reverse-proxy hops sit in front of the
	// service, counted from the RIGHT of X-Forwarded-For. The real client IP is the
	// entry that many positions left of the rightmost. 0 (default) suits Cloud Run's
	// direct domain mapping, where the platform appends the observed client IP as the
	// last entry; put a Global external ALB in front and it becomes 1 (the LB appends
	// its forwarding-rule IP after the client IP). Never trust the leftmost entry — it
	// is fully client-controlled and would let an attacker rotate the rate-limit key.
	TrustedProxyDepth int `env:"TRUSTED_PROXY_DEPTH" envDefault:"0"`

	// RateLimitFailOpen makes the auth rate limiter allow requests through when Redis is
	// unreachable, instead of denying (429). It defaults to false — fail CLOSED — so any
	// internet-facing deploy (prod, staging, an exposed sandbox) keeps brute-force and
	// spam protection during a Redis blip regardless of ENV. Set RATE_LIMIT_FAIL_OPEN=true
	// only for true local development, where a Redis outage should not lock you out (and
	// the rest of auth is unusable anyway, since sessions/tokens also need Redis).
	RateLimitFailOpen bool `env:"RATE_LIMIT_FAIL_OPEN"`

	// AllowedOrigins is the explicit allowlist of browser origins permitted to make
	// credentialed (cookie) requests — the SPA origin(s). It is BOTH the CORS
	// response-header allowlist and the CSRF trusted-origin allowlist. During the
	// migration the SPA is served from https://beta.devstash.one (the Vercel prod app at
	// devstash.one / www is NOT here — it calls its own same-origin API, never this Go
	// one). Empty in local dev (the Vite proxy makes the SPA same-origin, so CORS is off
	// and CSRF still passes same-origin); it MUST be set in production.
	AllowedOrigins []string `env:"ALLOWED_ORIGINS" envSeparator:","`

	// CookieDomain sets the session cookie's Domain attribute. Leave empty (the default)
	// for a host-only cookie scoped to the API host alone (api.devstash.one). The browser
	// still attaches a host-only cookie to every request TO that host — including the
	// credentialed fetches the SPA on a same-site subdomain (beta.devstash.one) makes, and
	// the cookie is httpOnly so the SPA never reads it — so host-only is both sufficient
	// and the tightest scope. Set a parent domain like ".devstash.one" ONLY if a cookie
	// must be shared across multiple distinct subdomains (e.g. a separate SSE host); that
	// widens exposure to every subdomain (incl. the Vercel app), so prefer empty.
	CookieDomain string `env:"COOKIE_DOMAIN"`

	// Email verification kill-switch (shared with the Next app). When "true", email
	// verification is bypassed (auto-verify, no unverified gate) AND all outbound email
	// no-ops (see buildEmailer). Kept as a raw string to match the Next app's strict
	// `=== 'true'` check exactly: any other value — including unset, "1", or an
	// unparseable "yes" — leaves verification on, rather than diverging from Next (which
	// treats "1" as false) or refusing to boot as a `bool` env tag would on "yes". Read
	// via EmailVerificationDisabled.
	DisableEmailVerification string `env:"DISABLE_EMAIL_VERIFICATION"`
}

// EmailVerificationDisabled reports whether the email kill-switch is on, matching the
// Next app's strict equality: only the literal "true" disables verification/email.
func (c *Config) EmailVerificationDisabled() bool {
	return c.DisableEmailVerification == "true"
}

// OutboundEmailEnabled reports whether the service actually sends transactional email:
// verification must be ON *and* a Resend key configured. Both the verification gating
// (auth.Config.OutboundEmailEnabled, consulted by login/register) and the emailer
// selection (buildEmailer) derive from this single predicate, so they can never
// disagree — a missing key means "no outbound email" everywhere, never a state where
// the app gates logins on a verification email it silently never sends.
func (c *Config) OutboundEmailEnabled() bool {
	return c.ResendAPIKey != "" && !c.EmailVerificationDisabled()
}

// envProduction is the ENV value that switches on production-only behaviour and the
// stricter boot-time validation below.
const envProduction = "production"

// IsProduction reports whether the environment is production.
func (c *Config) IsProduction() bool {
	return c.Env == envProduction
}

// validate enforces cross-field invariants that env struct tags can't express.
func (c *Config) validate() error {
	if c.TrustedProxyDepth < 0 {
		return errors.New("config: TRUSTED_PROXY_DEPTH must be greater than or equal to 0")
	}

	// Drop blank origins from a stray/trailing comma (e.g. "https://a.com,") before they
	// reach the CORS + CSRF allowlists, where an empty "" entry either panics
	// AddTrustedOrigin at boot or silently widens the trusted set.
	c.AllowedOrigins = slices.DeleteFunc(c.AllowedOrigins, func(o string) bool {
		return strings.TrimSpace(o) == ""
	})

	// Validate each origin's shape here (scheme://host, no path/query/fragment) so a typo
	// surfaces as a clean config error at boot rather than a raw panic deep in router
	// construction, where CrossOriginProtection.AddTrustedOrigin rejects a malformed value.
	for _, o := range c.AllowedOrigins {
		u, err := url.Parse(o)
		if err != nil || u.Scheme == "" || u.Host == "" || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
			return fmt.Errorf(
				"config: ALLOWED_ORIGINS entry %q is not a valid origin (want scheme://host, e.g. https://beta.devstash.one)",
				o,
			)
		}
	}

	// In production the SPA lives on a different origin (beta./www.devstash.one) and
	// Go 1.25's CrossOriginProtection rejects even same-site requests whose Origin isn't
	// trusted — the trusted set is exactly ALLOWED_ORIGINS. Left empty, every state-
	// changing browser request 403s at runtime with only a warning in the logs, so fail
	// fast at boot instead of shipping a silently-broken SPA.
	if c.IsProduction() && len(c.AllowedOrigins) == 0 {
		return errors.New(
			"config: ALLOWED_ORIGINS must be set in production (the SPA origins) — without it " +
				"every cross-origin browser write is rejected by the CSRF guard",
		)
	}
	// In production, verification being ON but no sender configured would fall back to
	// the no-op emailer while nothing gates on the (never-sent) verification email —
	// silently auto-accepting unverified addresses and locking real users out of a link
	// that never arrives. Require real email config whenever verification is enabled;
	// the kill-switch (DISABLE_EMAIL_VERIFICATION=true) is the explicit opt-out.
	if c.IsProduction() && !c.EmailVerificationDisabled() &&
		(c.ResendAPIKey == "" || c.EmailFrom == "") {
		return errors.New(
			"config: RESEND_API_KEY and EMAIL_FROM must be set in production unless " +
				"DISABLE_EMAIL_VERIFICATION=true",
		)
	}
	return nil
}

// Load reads .env / .env.local from the repo root (the shared file both Next.js
// and Go use), then parses environment variables into Config. Only loads dotenv
// files in development — in production the platform injects vars natively. The
// logger is injected (not the slog global) so best-effort dotenv warnings flow
// through the same handler as the rest of the process.
func Load(logger *slog.Logger) (*Config, error) {
	if os.Getenv("ENV") != envProduction {
		// Locate the repo root (where the shared .env lives) by walking up from
		// the working directory to the .git dir. In dev, air runs from backend/,
		// so this finds the parent repo root. Best-effort: if not found, env vars
		// may already be exported, so we just skip dotenv loading.
		root, err := repoRoot()
		if err != nil {
			logger.Warn("could not locate repo root for .env loading", "err", err)
		} else {
			for _, name := range []string{".env", ".env.local"} {
				path := filepath.Join(root, name)
				if err := godotenv.Load(path); err != nil && !os.IsNotExist(err) {
					logger.Warn("could not load env file", "path", path, "err", err)
				}
			}
		}
	}

	cfg, err := env.ParseAs[Config]()
	if err != nil {
		return nil, fmt.Errorf("config: parse env: %w", err)
	}
	if err := cfg.validate(); err != nil {
		return nil, err
	}
	return &cfg, nil
}

// repoRoot walks up from the current working directory until it finds a .git
// entry, returning that directory (the repo root, where the shared .env lives).
// Unlike a runtime.Caller-based approach, this doesn't depend on compile-time
// source paths, so it survives `go build -trimpath` and running the binary
// from a copied location. Only used in development.
func repoRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("getwd: %w", err)
	}
	for {
		// .git is a dir in a normal clone and a file in a worktree; Stat matches both.
		if _, err := os.Stat(filepath.Join(dir, ".git")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", errors.New("repo root (.git) not found from working directory")
		}
		dir = parent
	}
}
