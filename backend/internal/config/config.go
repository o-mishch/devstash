// Package config loads the environment configuration shared with the Next.js app.
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"

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

	// Auth
	AuthSecret string `env:"AUTH_SECRET,required"`

	// OAuth — GitHub (NextAuth v5 auto-inferred names; shared with the existing app)
	GitHubClientID     string `env:"AUTH_GITHUB_ID,required"`
	GitHubClientSecret string `env:"AUTH_GITHUB_SECRET,required"`

	// OAuth — Google (NextAuth v5 auto-inferred names; shared with the existing app)
	GoogleClientID     string `env:"AUTH_GOOGLE_ID,required"`
	GoogleClientSecret string `env:"AUTH_GOOGLE_SECRET,required"`

	// Redis (Upstash)
	RedisURL string `env:"UPSTASH_REDIS_REST_URL"`

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
}

// Load reads .env / .env.local from the repo root (the shared file both Next.js
// and Go use), then parses environment variables into Config. Only loads dotenv
// files in development — in production the platform injects vars natively. The
// logger is injected (not the slog global) so best-effort dotenv warnings flow
// through the same handler as the rest of the process.
func Load(logger *slog.Logger) (*Config, error) {
	if os.Getenv("ENV") != "production" {
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
