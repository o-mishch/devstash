package auth

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/o-mishch/devstash/backend/db"
	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
	pgconn "github.com/o-mishch/devstash/backend/internal/postgres"
)

// This file anchors the in-memory fakeUserStore semantics (fakes_ext_test.go) against
// the REAL sqlc queries running on a throwaway Postgres. The handler tests all run
// against the fakes; without this, a drift between a real query's WHERE/RETURNING/
// CASE/conflict behaviour and the fake's re-encoded assumptions would leave every
// handler test green while production silently broke. It exercises the writer surface
// the auth flows depend on, asserting the exact behaviours the fakes assume:
//   - InsertCredentialUser returns the row; a duplicate email is a 23505 (unique)
//   - MarkEmailVerifiedByEmail no-ops once already verified (the WHERE ... IS NULL guard)
//   - SetPasswordAndVerifyEmail verifies the credential email only when it is in sync
//   - ChangeCredentialEmail moves the primary email in lockstep and 23505s on a taken one
//   - the verified-credential-email lookup filters on credentialEmailVerified IS NOT NULL

// realUserStore starts a per-test Postgres, applies the embedded goose baseline, and
// returns the real sqlc *Queries (which satisfies UserStore). Torn down via t.Cleanup.
func realUserStore(t *testing.T) *sqlcdb.Queries {
	t.Helper()
	ctx := context.Background()

	container, err := postgres.Run(ctx, "postgres:17-alpine",
		postgres.WithDatabase("devstash_test"),
		postgres.WithUsername("test"),
		postgres.WithPassword("test"),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2).WithStartupTimeout(60*time.Second),
		),
	)
	if err != nil {
		t.Fatalf("start postgres container: %v", err)
	}
	t.Cleanup(func() {
		if termErr := testcontainers.TerminateContainer(container); termErr != nil {
			t.Logf("terminate postgres container: %v", termErr)
		}
	})

	dsn, err := container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("connection string: %v", err)
	}

	pool, err := pgconn.Connect(ctx, dsn, discardLogger())
	if err != nil {
		t.Fatalf("connect pool: %v", err)
	}
	t.Cleanup(pool.Close)

	sqlDB := stdlib.OpenDBFromPool(pool)
	goose.SetBaseFS(db.Migrations)
	goose.SetTableName("goose_db_version")
	if err := goose.Up(sqlDB, "migrations"); err != nil {
		t.Fatalf("apply migrations: %v", err)
	}
	return sqlcdb.New(pool)
}

func TestUserStoreWritersAgainstPostgres(t *testing.T) {
	store := realUserStore(t)
	ctx := t.Context()
	now := time.Now()

	t.Run("insert then duplicate-email is a unique violation", func(t *testing.T) {
		email := "dup@example.com"
		if _, err := store.InsertCredentialUser(ctx, insertParams("u-dup", email)); err != nil {
			t.Fatalf("first insert: %v", err)
		}
		_, err := store.InsertCredentialUser(ctx, insertParams("u-dup2", email))
		if !isUniqueViolation(err) {
			t.Fatalf("second insert err = %v, want a 23505 unique violation", err)
		}
	})

	t.Run("MarkEmailVerifiedByEmail sets then no-ops once verified", func(t *testing.T) {
		email := "verify@example.com"
		if _, err := store.InsertCredentialUser(ctx, insertParams("u-verify", email)); err != nil {
			t.Fatalf("insert: %v", err)
		}
		if err := store.MarkEmailVerifiedByEmail(ctx, email); err != nil {
			t.Fatalf("first mark: %v", err)
		}
		u, err := store.GetUserByEmail(ctx, email)
		if err != nil {
			t.Fatalf("get: %v", err)
		}
		if u.EmailVerified == nil {
			t.Fatal("emailVerified should be set after the first mark")
		}
		first := *u.EmailVerified
		// The query's WHERE "emailVerified" IS NULL means a second call is a no-op —
		// the fake relies on exactly this to stay idempotent.
		if markErr := store.MarkEmailVerifiedByEmail(ctx, email); markErr != nil {
			t.Fatalf("second mark: %v", markErr)
		}
		u2, err := store.GetUserByEmail(ctx, email)
		if err != nil {
			t.Fatalf("re-get: %v", err)
		}
		if !u2.EmailVerified.Equal(first) {
			t.Errorf("second mark changed emailVerified %v -> %v; want a no-op", first, *u2.EmailVerified)
		}
	})

	t.Run("verified-credential-email lookup filters on IS NOT NULL", func(t *testing.T) {
		email := "primary-cred@example.com"
		cred := "cred-unverified@example.com"
		p := insertParams("u-cred", email)
		p.CredentialEmail = &cred // credentialEmail set but credentialEmailVerified stays NULL
		if _, err := store.InsertCredentialUser(ctx, p); err != nil {
			t.Fatalf("insert: %v", err)
		}
		if _, err := store.GetUserByVerifiedCredentialEmail(ctx, &cred); !errors.Is(err, pgx.ErrNoRows) {
			t.Fatalf("unverified credential email lookup = %v, want ErrNoRows", err)
		}
	})

	t.Run("SetPasswordAndVerifyEmail verifies the credential email only when in sync", func(t *testing.T) {
		// In-sync: credentialEmail == the address passed as $3 → credentialEmailVerified set.
		email := "insync@example.com"
		p := insertParams("u-insync", email)
		p.CredentialEmail = &email
		if _, err := store.InsertCredentialUser(ctx, p); err != nil {
			t.Fatalf("insert: %v", err)
		}
		hash := "hash"
		if err := store.SetPasswordAndVerifyEmail(ctx, sqlcdb.SetPasswordAndVerifyEmailParams{
			ID: "u-insync", Password: &hash, CredentialEmail: &email,
		}); err != nil {
			t.Fatalf("set: %v", err)
		}
		u, err := store.GetUserByID(ctx, "u-insync")
		if err != nil {
			t.Fatalf("get: %v", err)
		}
		if u.EmailVerified == nil || u.CredentialEmailVerified == nil {
			t.Errorf("in-sync set should verify both emails; got emailVerified=%v credVerified=%v",
				u.EmailVerified, u.CredentialEmailVerified)
		}
	})

	t.Run("ChangeCredentialEmail moves the primary email in lockstep and 23505s on a taken one", func(t *testing.T) {
		// Seed a user whose primary email equals its credential email, so the CASE moves both.
		shared := "old-shared@example.com"
		p := insertParams("u-change", shared)
		p.CredentialEmail = &shared
		p.CredentialEmailVerified = &now
		if _, err := store.InsertCredentialUser(ctx, p); err != nil {
			t.Fatalf("insert: %v", err)
		}
		fresh := "new-shared@example.com"
		if err := store.ChangeCredentialEmail(ctx, sqlcdb.ChangeCredentialEmailParams{
			ID: "u-change", CredentialEmail: &fresh,
		}); err != nil {
			t.Fatalf("change: %v", err)
		}
		u, err := store.GetUserByID(ctx, "u-change")
		if err != nil {
			t.Fatalf("get: %v", err)
		}
		if u.Email != fresh {
			t.Errorf("primary email = %q, want it moved to %q (was in sync with the credential email)", u.Email, fresh)
		}

		// A second user re-pointing to that same, already-taken credential email 23505s.
		if _, insErr := store.InsertCredentialUser(ctx, insertParams("u-other", "other@example.com")); insErr != nil {
			t.Fatalf("insert other: %v", insErr)
		}
		err = store.ChangeCredentialEmail(ctx, sqlcdb.ChangeCredentialEmailParams{
			ID: "u-other", CredentialEmail: &fresh,
		})
		if !isUniqueViolation(err) {
			t.Fatalf("change to a taken credential email err = %v, want a 23505 unique violation", err)
		}
	})
}

// insertParams builds a minimal valid InsertCredentialUser argument set (unverified,
// no credential email) for the given id/email.
func insertParams(id, email string) sqlcdb.InsertCredentialUserParams {
	name, hash := "Test User", "hash"
	return sqlcdb.InsertCredentialUserParams{
		ID:       id,
		Email:    email,
		Name:     &name,
		Password: &hash,
	}
}
