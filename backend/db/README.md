# Database migrations (goose)

goose owns all schema changes from the baseline onward. Prisma migrations under
`prisma/migrations/` are **frozen** — do not add new ones during the strangler period.

## Layout

- `migrations/` — goose SQL migrations. `00001_baseline.sql` is the squashed baseline:
  the schema exactly as already applied on the Neon `dev` branch, produced with
  `prisma migrate diff --from-empty --to-config-datasource prisma.config.ts --script`.
- `queries/` — sqlc query sources. Seeded in Phase 0 with a minimal `auth.sql`
  (`GetUserByID`/`GetUserByEmail`) to exercise the sqlc pipeline end to end; the
  full per-domain query set lands from Phase 1 onward.

## Entities & queries (sqlc)

There is no ORM and no hand-written entity structs. [sqlc](https://sqlc.dev) **generates**
type-safe Go from SQL — the schema is the source of truth, structs follow it (the inverse
of Prisma's model-first flow). Three locations, one direction:

```
migrations/*.sql   ──┐  (schema / DDL — goose owns it)
                     ├─► sqlc generate ─► ../internal/db/   (generated Go — package sqlcdb)
queries/*.sql      ──┘  (the SQL you write)
```

| What | Where | Written by |
|---|---|---|
| Schema (tables, enums) | `db/migrations/` | You (goose) |
| Queries | `db/queries/*.sql` | You (SQL + sqlc annotations) |
| Entities + accessors | `internal/db/` (`package sqlcdb`) | **Generated — never hand-edited** |

Config lives in [`../sqlc.yaml`](../sqlc.yaml) (pgx/v5-native, so the generated `Queries`
takes our `*pgxpool.Pool`). Regenerate after any schema or query change:

```bash
task backend:sqlc:gen     # from repo root  (or `task sqlc:gen` from backend/)
```

It reads the migrations for table shapes plus every `queries/*.sql` and writes three
generated files into `internal/db/`:

- `models.go` — one struct per table (the entities: `type User struct { … }`)
- `*.sql.go` — one typed method per query
- `db.go` — the `Querier` interface + `New(pool)` constructor

### Adding a query

```sql
-- db/queries/users.sql
-- name: GetUserByID :one
SELECT * FROM users WHERE id = $1;
```

`task backend:sqlc:gen` then emits `func (q *Queries) GetUserByID(ctx, id string) (User, error)`.
A typo'd column fails generation, not production. Per the feature doc, each domain package
wraps these generated methods behind a **narrow, consumer-defined interface** (backed by an
in-memory fake in tests) — callers don't depend on the whole `Querier`. Generated code is
excluded from lint/coverage; never edit `internal/db/` by hand.

> `sqlc generate` requires at least one query — running it against an empty `queries/` dir
> fails with `error parsing queries: no queries contained in paths …/db/queries`. The Phase 0
> seed `auth.sql` satisfies that, so `internal/db/` (package `sqlcdb`) is generated and present
> from Phase 0 on. The generated layer is not yet wired into any handler — it exists to validate
> the sqlc toolchain; Phase 1 is the first to consume it behind a domain interface.

## Commands

Run from `backend/` (the binary resolves `db/migrations` relative to CWD):

```bash
api migrate status   # show applied / pending
api migrate up       # apply pending migrations
api migrate down     # roll back the last migration
```

## Marking the baseline already-applied (existing environments)

On any database that **already has the schema** (Neon `dev`, and later `production`),
the baseline must be recorded as applied **without replaying it** — replaying would fail
because every table already exists. Seed goose's version table directly:

```sql
CREATE TABLE IF NOT EXISTS goose_db_version (
    id         serial      NOT NULL,
    version_id bigint      NOT NULL,
    is_applied boolean     NOT NULL,
    tstamp     timestamp   NULL DEFAULT now(),
    PRIMARY KEY (id)
);

-- goose's own bootstrap row, then the baseline marked applied.
INSERT INTO goose_db_version (version_id, is_applied) VALUES (0, true);
INSERT INTO goose_db_version (version_id, is_applied) VALUES (1, true);
```

Then `api migrate status` reports `00001_baseline` as applied and `api migrate up` is a
no-op. A **fresh** database instead runs `api migrate up`, which executes the baseline
normally.
