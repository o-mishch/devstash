package config

import (
	"log/slog"
	"os"
	"path/filepath"
	"testing"
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

	cfg, err := Load(testLogger())
	if err != nil {
		t.Fatalf("Load() error = %v, want nil", err)
	}
	if cfg.EmailFrom != "from-dotenv@example.com" {
		t.Errorf("EmailFrom = %q, want it loaded from the repo-root .env", cfg.EmailFrom)
	}
}
