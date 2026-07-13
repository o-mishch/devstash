package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/spf13/cobra"

	"github.com/o-mishch/devstash/backend/internal/auth"
	"github.com/o-mishch/devstash/backend/internal/collections"
	"github.com/o-mishch/devstash/backend/internal/config"
	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
	"github.com/o-mishch/devstash/backend/internal/email"
	"github.com/o-mishch/devstash/backend/internal/items"
	"github.com/o-mishch/devstash/backend/internal/postgres"
	"github.com/o-mishch/devstash/backend/internal/ratelimit"
	"github.com/o-mishch/devstash/backend/internal/redisconn"
	"github.com/o-mishch/devstash/backend/internal/search"
	"github.com/o-mishch/devstash/backend/internal/session"
)

// newID generates a time-ordered UUIDv7 for new rows. NewV7 only errors if the
// system RNG fails, which is fatal for the process, so a panic is acceptable.
func newID() string {
	return uuid.Must(uuid.NewV7()).String()
}

// buildEmailer returns the Resend-backed emailer, or a no-op when outbound email is
// off (no API key configured OR the kill-switch set — see Config.OutboundEmailEnabled).
// It shares that one predicate with the auth.Config.OutboundEmailEnabled flag below, so
// the emailer and the verification gating can never disagree. This is also the single
// enforcement point for the "never send outbound email" guarantee (security.md § Dev
// Email Kill Switch): with the switch on, EVERY email — verification, reset,
// credential-email, and the password-flow security notifications — no-ops, without each
// handler having to remember to gate its send.
func buildEmailer(cfg *config.Config) auth.Emailer {
	if !cfg.OutboundEmailEnabled() {
		return email.Noop{}
	}
	return email.New(cfg.ResendAPIKey, cfg.EmailFrom, cfg.AppURL)
}

// buildOAuthProviders wires the OAuth providers whose credentials are configured. A
// provider with an empty id or secret is skipped, so a deploy without OAuth secrets
// (dev/CI) simply registers no OAuth routes rather than failing to boot. The
// redirect_uri is APIBaseURL + /auth/oauth/{provider}/callback — the value that must be
// registered in each provider's OAuth app allowlist. Returns nil when none are set.
func buildOAuthProviders(cfg *config.Config) map[string]auth.OAuthProvider {
	base := strings.TrimRight(cfg.APIBaseURL, "/")
	providers := map[string]auth.OAuthProvider{}
	if cfg.GitHubClientID != "" && cfg.GitHubClientSecret != "" {
		providers["github"] = auth.NewGitHubProvider(
			cfg.GitHubClientID, cfg.GitHubClientSecret, base+"/auth/oauth/github/callback",
		)
	}
	if cfg.GoogleClientID != "" && cfg.GoogleClientSecret != "" {
		providers["google"] = auth.NewGoogleProvider(
			cfg.GoogleClientID, cfg.GoogleClientSecret, base+"/auth/oauth/google/callback",
		)
	}
	if len(providers) == 0 {
		return nil
	}
	return providers
}

func serveCmd(app *appState) *cobra.Command {
	return &cobra.Command{
		Use:   "serve",
		Short: "Start the HTTP server",
		RunE: func(cmd *cobra.Command, _ []string) error {
			return runServe(cmd.Context(), app.cfg, app.logger)
		},
	}
}

// HTTP server timeouts. Explicit values (net/http defaults to "no timeout")
// harden the server against slow-client and Slowloris attacks (gosec G112).
const (
	readHeaderTimeout = 5 * time.Second
	readTimeout       = 15 * time.Second
	// writeTimeout caps a full response write. NOTE(phase6): the SSE / streaming
	// endpoints will need a per-route reset (http.ResponseController.SetWriteDeadline,
	// or a zero deadline on that handler) — a long-lived EventSource would otherwise be
	// cut off at this deadline. This global default stays as the Slowloris guard for
	// the ordinary JSON routes.
	writeTimeout    = 60 * time.Second
	idleTimeout     = 120 * time.Second
	shutdownTimeout = 10 * time.Second
)

// runServe starts the HTTP server and blocks until an interrupt, then shuts down
// gracefully. Shared by the `serve` subcommand and the root command's default
// action (bare invocation), so Cloud Run's argument-less launch of the image also serves.
func runServe(ctx context.Context, cfg *config.Config, logger *slog.Logger) error {
	// Connect both datastores on boot to fail fast on bad URLs. Postgres backs the
	// sqlc queries; Redis backs the session store, rate limiter, and one-time tokens.
	pool, err := postgres.Connect(ctx, cfg.DatabaseURL, logger)
	if err != nil {
		return err
	}
	defer pool.Close()

	rdb, err := redisconn.Connect(ctx, cfg.RedisURL, logger)
	if err != nil {
		return err
	}
	defer func() { _ = rdb.Close() }()

	queries := sqlcdb.New(pool)
	sessions := session.New(rdb, session.Config{
		Lifetime:     session.MaxAge,
		IdleTimeout:  session.IdleTimeout,
		CookieDomain: cfg.CookieDomain,
		Secure:       cfg.IsProduction(),
	})
	limiter := ratelimit.New(rdb)
	// All domains share the one pgx pool (via the sqlc *Queries), the Redis limiter, the
	// UUIDv7 id generator, and the logger. Each domain's narrow store interface is satisfied
	// by that same *Queries.
	d := domains{
		auth: auth.Deps{
			Users:     queries,
			Sessions:  sessions,
			Limiter:   limiter,
			Tokens:    auth.NewTokens(rdb),
			Email:     buildEmailer(cfg),
			Providers: buildOAuthProviders(cfg),
			IDs:       newID,
			Logger:    logger,
			Cfg: auth.Config{
				AppURL:               cfg.AppURL,
				OutboundEmailEnabled: cfg.OutboundEmailEnabled(),
				FailClosed:           !cfg.RateLimitFailOpen,
				TrustedProxyDepth:    cfg.TrustedProxyDepth,
			},
		},
		items: items.Deps{
			Store:   queries,
			Limiter: limiter,
			IDs:     newID,
			Logger:  logger,
			Cfg:     items.Config{FailClosed: !cfg.RateLimitFailOpen},
		},
		collections: collections.Deps{
			Store:  queries,
			IDs:    newID,
			Logger: logger,
		},
		search: search.Deps{
			Store:  queries,
			Logger: logger,
		},
	}

	srv := &http.Server{
		Addr: ":" + cfg.Port,
		// Docs/spec routes are served only outside production (they'd publish the auth
		// attack surface); `openapi emit` still produces the spec for codegen.
		Handler: newRouter(
			sessions,
			d,
			queries,
			pool,
			cfg.AllowedOrigins,
			!cfg.IsProduction(),
			logger,
		),
		ReadHeaderTimeout: readHeaderTimeout, // Slowloris mitigation (gosec G112)
		ReadTimeout:       readTimeout,
		WriteTimeout:      writeTimeout,
		IdleTimeout:       idleTimeout,
	}

	// ListenAndServe blocks, so run it in a goroutine and surface a startup
	// failure (e.g. port in use) back through this channel — never os.Exit from
	// the goroutine, which would skip the deferred pool.Close() above.
	serverErr := make(chan error, 1)
	go func() {
		logger.InfoContext(ctx, "server listening", "addr", srv.Addr, "env", cfg.Env)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
		}
	}()

	select {
	case err := <-serverErr:
		return fmt.Errorf("server: %w", err)
	case <-ctx.Done():
		logger.InfoContext(ctx, "shutting down")
		// ctx is already cancelled (that's why we're here). WithoutCancel keeps its
		// values but drops the cancellation, so shutdown gets its full grace period
		// on a context still derived from ctx (no contextcheck suppression needed).
		shutCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), shutdownTimeout)
		defer cancel()
		return srv.Shutdown(shutCtx)
	}
}
