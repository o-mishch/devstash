package config

import (
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/go-cmp/cmp"
)

// testLogger returns a logger that discards output — Load's dotenv warnings are
// best-effort and irrelevant to these assertions.
func testLogger() *slog.Logger {
	return slog.New(slog.DiscardHandler)
}

// setRequiredEnv sets every `required` env var to a dummy value so Load succeeds.
// ENV=production is set by callers to skip the dotenv walk (tests must not depend
// on a repo-root .env file being present or absent).
func setRequiredEnv(t *testing.T) {
	t.Helper()
	t.Setenv("ENV", "production")
	t.Setenv("DATABASE_URL", "postgres://user:pass@localhost:5432/db")
	t.Setenv("AUTH_SECRET", "test-secret")
	t.Setenv("AUTH_GITHUB_ID", "gh-id")
	t.Setenv("AUTH_GITHUB_SECRET", "gh-secret")
	t.Setenv("AUTH_GOOGLE_ID", "goog-id")
	t.Setenv("AUTH_GOOGLE_SECRET", "goog-secret")
	t.Setenv("REDIS_URL", "redis://localhost:6379")
	// Required in production (validate()): without it the CSRF guard would 403 every
	// cross-origin SPA write. Set here so the ENV=production tests below boot cleanly.
	t.Setenv("ALLOWED_ORIGINS", "https://devstash.one")
	// Required in production when email verification is on (validate()): the app would
	// otherwise gate logins on a verification email the no-op emailer never sends.
	t.Setenv("RESEND_API_KEY", "re_test")
	t.Setenv("EMAIL_FROM", "noreply@devstash.one")
}

// unsetEnv clears a var the shell running the suite may have exported, restoring it on cleanup
// — needed for tests that assert a var is populated only via a specific path (APP_CONFIG, etc.).
// t.Setenv can't unset, and os.Unsetenv can't run inside t.Cleanup's t.Setenv, so this restores
// with os.Setenv directly.
func unsetEnv(t *testing.T, key string) {
	t.Helper()
	orig, had := os.LookupEnv(key)
	if !had {
		return
	}
	if err := os.Unsetenv(key); err != nil {
		t.Fatalf("unset %s: %v", key, err)
	}
	t.Cleanup(func() { _ = os.Setenv(key, orig) }) //nolint:usetesting // can't unset/restore via t.Setenv
}

// TestLoadHydratesFromAppConfig proves the consolidated-secret path: a required var supplied
// ONLY in the APP_CONFIG JSON blob (and unset in the environment) reaches Config — so Cloud Run
// can mount one secret instead of one-per-var.
func TestLoadHydratesFromAppConfig(t *testing.T) {
	unsetEnv(t, "REDIS_URL") // prove it comes from the blob, not a shell export

	t.Setenv("ENV", "production")
	t.Setenv("DATABASE_URL", "postgres://user:pass@localhost:5432/db")
	t.Setenv("ALLOWED_ORIGINS", "https://beta.devstash.one")
	t.Setenv("RESEND_API_KEY", "re_test")
	t.Setenv("EMAIL_FROM", "noreply@devstash.one")
	t.Setenv("APP_CONFIG", `{"REDIS_URL":"redis://from-blob:6379"}`)

	cfg, err := Load(testLogger())
	if err != nil {
		t.Fatalf("Load() error = %v, want nil", err)
	}
	if cfg.RedisURL != "redis://from-blob:6379" {
		t.Errorf("RedisURL = %q, want the value hydrated from APP_CONFIG", cfg.RedisURL)
	}
}

// TestLoadAppConfigDoesNotOverrideExplicitEnv proves the blob is a FALLBACK: an env var already
// set (here via setRequiredEnv) wins over the same key in APP_CONFIG, so explicit per-var
// overrides and local dev stay authoritative.
func TestLoadAppConfigDoesNotOverrideExplicitEnv(t *testing.T) {
	setRequiredEnv(t) // sets REDIS_URL=redis://localhost:6379
	t.Setenv("APP_CONFIG", `{"REDIS_URL":"redis://from-blob:6379"}`)

	cfg, err := Load(testLogger())
	if err != nil {
		t.Fatalf("Load() error = %v, want nil", err)
	}
	if cfg.RedisURL != "redis://localhost:6379" {
		t.Errorf("RedisURL = %q, want the explicit env value to win over APP_CONFIG", cfg.RedisURL)
	}
}

// TestLoadFailsOnMalformedAppConfig guards the error branch: a non-JSON APP_CONFIG must fail
// Load loudly at boot rather than silently leaving required vars unset.
func TestLoadFailsOnMalformedAppConfig(t *testing.T) {
	setRequiredEnv(t)
	t.Setenv("APP_CONFIG", "{not-valid-json")

	if _, err := Load(testLogger()); err == nil {
		t.Fatal("Load() error = nil, want an error for malformed APP_CONFIG")
	}
}

func TestLoadParsesRequiredEnvAndDefaults(t *testing.T) {
	setRequiredEnv(t)

	cfg, err := Load(testLogger())
	if err != nil {
		t.Fatalf("Load() error = %v, want nil", err)
	}

	if cfg.DatabaseURL != "postgres://user:pass@localhost:5432/db" {
		t.Errorf("DatabaseURL = %q, want the value from env", cfg.DatabaseURL)
	}
	// Env is set explicitly above; Port and AppURL fall back to envDefault.
	if cfg.Port != "8080" {
		t.Errorf("Port = %q, want default 8080", cfg.Port)
	}
	if cfg.S3Region != "auto" {
		t.Errorf("S3Region = %q, want default auto", cfg.S3Region)
	}
	if cfg.AppURL != "http://localhost:3000" {
		t.Errorf("AppURL = %q, want default localhost:3000", cfg.AppURL)
	}
	// TrustedProxyDepth defaults to 0 (Cloud Run direct: real client IP is rightmost).
	if cfg.TrustedProxyDepth != 0 {
		t.Errorf("TrustedProxyDepth = %d, want default 0", cfg.TrustedProxyDepth)
	}
	if diff := cmp.Diff([]string{"https://devstash.one"}, cfg.AllowedOrigins); diff != "" {
		t.Errorf("AllowedOrigins mismatch (-want +got):\n%s", diff)
	}
}

// TestLoadFailsWhenProductionMissingAllowedOrigins guards the boot-time check: in
// production an empty ALLOWED_ORIGINS is fatal (an empty CSRF allowlist would 403 every
// cross-origin SPA write), so Load must refuse to start rather than warn and continue.
func TestLoadFailsWhenProductionMissingAllowedOrigins(t *testing.T) {
	t.Setenv("ENV", "production")
	t.Setenv("DATABASE_URL", "postgres://user:pass@localhost:5432/db")
	t.Setenv("REDIS_URL", "redis://localhost:6379")
	t.Setenv("ALLOWED_ORIGINS", "") // explicit empty — the shell may otherwise export it

	if _, err := Load(testLogger()); err == nil {
		t.Fatal("Load() error = nil, want an error for empty ALLOWED_ORIGINS in production")
	}
}

// TestLoadOnlyDatabaseAndRedisAreRequired proves that AUTH_SECRET and the four OAuth
// vars are optional: with just the two truly-required vars set, Load succeeds. This
// guards against a regression that re-adds `,required` to secrets no code reads yet.
func TestLoadOnlyDatabaseAndRedisAreRequired(t *testing.T) {
	t.Setenv("ENV", "production") // skip the dotenv walk
	t.Setenv("DATABASE_URL", "postgres://user:pass@localhost:5432/db")
	t.Setenv("REDIS_URL", "redis://localhost:6379")
	t.Setenv("ALLOWED_ORIGINS", "https://devstash.one,https://www.devstash.one")
	// Production with verification on also requires email config (validate()); set it so
	// this test stays focused on what it guards — that the OAuth/AUTH_SECRET secrets don't.
	t.Setenv("RESEND_API_KEY", "re_test")
	t.Setenv("EMAIL_FROM", "noreply@devstash.one")

	// No AUTH_SECRET / AUTH_GITHUB_* / AUTH_GOOGLE_* set here — Load must still succeed,
	// proving they carry no `,required`. (We don't assert they're empty: the shell
	// running the suite may export them, and that's not what this test guards.)
	cfg, err := Load(testLogger())
	if err != nil {
		t.Fatalf("Load() error = %v, want nil (OAuth/AUTH_SECRET are optional)", err)
	}
	want := []string{"https://devstash.one", "https://www.devstash.one"}
	if diff := cmp.Diff(want, cfg.AllowedOrigins); diff != "" {
		t.Errorf("AllowedOrigins mismatch (-want +got):\n%s", diff)
	}
}

// TestLoadFailsWhenProductionEmailMisconfigured guards the boot-time invariant that a
// production deploy with email verification ON must carry a real sender: without
// RESEND_API_KEY/EMAIL_FROM the emailer silently no-ops while the app still gates logins
// on a verification email that never arrives, so Load must refuse to start. The explicit
// kill-switch (DISABLE_EMAIL_VERIFICATION=true) is the sanctioned opt-out.
func TestLoadFailsWhenProductionEmailMisconfigured(t *testing.T) {
	t.Setenv("ENV", "production")
	t.Setenv("DATABASE_URL", "postgres://user:pass@localhost:5432/db")
	t.Setenv("REDIS_URL", "redis://localhost:6379")
	t.Setenv("ALLOWED_ORIGINS", "https://devstash.one")
	t.Setenv("RESEND_API_KEY", "") // explicit empty — the shell may otherwise export it
	t.Setenv("EMAIL_FROM", "")
	t.Setenv("DISABLE_EMAIL_VERIFICATION", "")

	if _, err := Load(testLogger()); err == nil {
		t.Fatal("Load() error = nil, want an error for missing email config in production")
	}

	// With the kill-switch on, the same config boots — email is intentionally off.
	t.Setenv("DISABLE_EMAIL_VERIFICATION", "true")
	if _, err := Load(testLogger()); err != nil {
		t.Fatalf("Load() error = %v, want nil when DISABLE_EMAIL_VERIFICATION=true", err)
	}
}

func TestLoadFailsWhenRequiredMissing(t *testing.T) {
	// Explicitly unset DATABASE_URL — the shell running the tests may export it,
	// and `required` distinguishes unset from empty. Restore on cleanup.
	if orig, had := os.LookupEnv("DATABASE_URL"); had {
		if err := os.Unsetenv("DATABASE_URL"); err != nil {
			t.Fatalf("unset DATABASE_URL: %v", err)
		}
		// t.Setenv can only set a value (not unset) and cannot run inside Cleanup,
		// so the original is restored with os.Setenv directly.
		t.Cleanup(func() {
			_ = os.Setenv("DATABASE_URL", orig) //nolint:usetesting // can't unset/restore via t.Setenv
		})
	}

	// Set ENV=production (skip dotenv) but leave DATABASE_URL unset.
	t.Setenv("ENV", "production")
	t.Setenv("AUTH_SECRET", "test-secret")
	t.Setenv("AUTH_GITHUB_ID", "gh-id")
	t.Setenv("AUTH_GITHUB_SECRET", "gh-secret")
	t.Setenv("AUTH_GOOGLE_ID", "goog-id")
	t.Setenv("AUTH_GOOGLE_SECRET", "goog-secret")
	t.Setenv("REDIS_URL", "redis://localhost:6379")

	if _, err := Load(testLogger()); err == nil {
		t.Fatal("Load() error = nil, want an error for missing DATABASE_URL")
	}
}

// TestLoadDevWithoutRepoRootStillParses drives the development branch (ENV != production)
// from a directory with no .git ancestor: repoRoot fails, Load logs a best-effort warning
// and skips dotenv, then parses the already-exported env vars successfully.
func TestLoadDevWithoutRepoRootStillParses(t *testing.T) {
	t.Chdir(t.TempDir()) // no .git ancestor → repoRoot returns an error
	t.Setenv("ENV", "development")
	t.Setenv("DATABASE_URL", "postgres://user:pass@localhost:5432/db")
	t.Setenv("AUTH_SECRET", "test-secret")
	t.Setenv("AUTH_GITHUB_ID", "gh-id")
	t.Setenv("AUTH_GITHUB_SECRET", "gh-secret")
	t.Setenv("AUTH_GOOGLE_ID", "goog-id")
	t.Setenv("AUTH_GOOGLE_SECRET", "goog-secret")
	t.Setenv("REDIS_URL", "redis://localhost:6379")

	cfg, err := Load(testLogger())
	if err != nil {
		t.Fatalf("Load() error = %v, want nil", err)
	}
	if cfg.Env != "development" {
		t.Errorf("Env = %q, want development", cfg.Env)
	}
}

// TestLoadDevReadsDotenvFromRepoRoot drives the happy dev path: a temp dir with a .git
// marker is found as the repo root, and a .env there populates a non-required var, proving
// godotenv.Load actually ran (the missing .env.local exercises the os.IsNotExist skip).
func TestLoadDevReadsDotenvFromRepoRoot(t *testing.T) {
	unsetEnv(t, "EMAIL_FROM") // clear pre-existing to verify godotenv loads it
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, ".git"), 0o755); err != nil {
		t.Fatalf("mkdir .git: %v", err)
	}
	// EMAIL_FROM is optional (no `required`), so it only ends up set if dotenv loaded it.
	if err := os.WriteFile(
		filepath.Join(root, ".env"),
		[]byte("EMAIL_FROM=from-dotenv@example.com\n"),
		0o600,
	); err != nil {
		t.Fatalf("write .env: %v", err)
	}
	// godotenv uses os.Setenv, which persists past the test — unset it on cleanup.
	t.Cleanup(func() { _ = os.Unsetenv("EMAIL_FROM") })

	t.Chdir(root)
	t.Setenv("ENV", "development")
	t.Setenv("DATABASE_URL", "postgres://user:pass@localhost:5432/db")
	t.Setenv("AUTH_SECRET", "test-secret")
	t.Setenv("AUTH_GITHUB_ID", "gh-id")
	t.Setenv("AUTH_GITHUB_SECRET", "gh-secret")
	t.Setenv("AUTH_GOOGLE_ID", "goog-id")
	t.Setenv("AUTH_GOOGLE_SECRET", "goog-secret")
	t.Setenv("REDIS_URL", "redis://localhost:6379")

	cfg, err := Load(testLogger())
	if err != nil {
		t.Fatalf("Load() error = %v, want nil", err)
	}
	if cfg.EmailFrom != "from-dotenv@example.com" {
		t.Errorf("EmailFrom = %q, want it loaded from the repo-root .env", cfg.EmailFrom)
	}
}
