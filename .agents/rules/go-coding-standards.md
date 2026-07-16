---
trigger: glob
globs: ["backend/**/*.go"]
paths:
  - "backend/**/*.go"
description: Standards for the Go backend (Huma v2 + sqlc + goose on Cloud Run) — vertical-slice architecture, validation/errors, logging, IDOR scoping, data access, and testing. Loads when editing any Go file under backend/. Loop/iteration style lives in go-iteration.md (same glob). Does not apply to backend/exercise/, which is an unrelated learning course.
---

# Go Coding Standards

`backend/` is a 100% Go module — no `package.json`, npm, or Node tooling anywhere inside it.

**Not in scope:** `backend/exercise/` is an independent Go learning course, not DevStash. Never review, edit, or flag it; its build errors are expected. Scope any verification with `go list ./... | grep -v /exercise`.

Loop and iteration style — the `slices`/`maps`-helper → value-only-range → classic-`for` ladder — lives in `go-iteration.md`, which loads on the same glob.

## Architecture — vertical slices

One package per domain under `internal/`, **one file per operation**. `internal/items` and `internal/collections` are the reference implementations; copy their shape.

- `<domain>.go` holds `Deps`, `Service`, `New(Deps) *Service`, `Register(api huma.API, d Deps)`, the store interface, and `enforceLimit`. Operations live in `create.go`, `get.go`, `list.go`, `update.go`, `delete.go`, and so on. Supporting files (`validate.go`, `constants.go`) are fine — the rule is that no file holds two operations.
- `Deps` is the exported constructor input and is **embedded verbatim** in `Service`. Methods take pointer receivers; handlers are stateless closures over the one `Service` built in `Register`.
- **Store interfaces are consumer-defined and declared in-package** — narrow, covering only what that domain calls, satisfied by the sqlc `*Queries`. Never a shared global `Querier`.
- Cross-domain wire DTOs go in `internal/apitypes`. Huma keys OpenAPI schema components by Go base-name, so a type defined twice under the same name emits a duplicate component — extract it instead.
- New row IDs come from the injected `IDs func() string` (UUIDv7 in production), never generated inline — that seam is what makes writes testable.

**Every route is a Huma operation.** Uniform OpenAPI, `Operation.Security`-driven middleware. No `authedRoute`/`publicRoute` wrappers.

## Validation and errors

- Presence, format, length, and enum go in **Huma struct tags**. Anything tags can't express goes in a `huma.Resolver` — `func (in *xInput) Resolve(_ huma.Context) []error`. No `go-playground/validator`, no hand-rolled `parseOr422`.
- Errors are **Huma-native RFC 9457**. No hand-rolled `problem()`/`json()` helpers.
- A 500 returns the opaque `genericErrorMessage`; the real error is logged, never leaked to the client.

## Logging

`internal/logging.New` builds one `*slog.Logger`, injected explicitly into the components that need it. There is no `slog.SetDefault` and no package-level logger — take the logger as a dependency. (`slog.Default()` in `newHumaAPI` is the spec-generation path only: no server, no requests.)

- **Always the `*Context` variant** — `ErrorContext(ctx, …)`, `InfoContext`, `WarnContext` — on any path that has a `ctx`. `logging.ctxHandler` folds the request id onto the record from the context, so a plain `logger.Error` compiles and logs but silently drops request correlation. Plain calls are correct **only** where no ctx exists (startup, config load, CLI subcommands).
- **Message first, then loose key-value pairs**: `logger.ErrorContext(ctx, "register failed", "err", err)`. This is the reverse of the Pino convention in `legacy-coding-standards.md § Logging`, which governs `src/` only — do not carry that order across stacks. No typed `slog.Attr` in call sites; the codebase uses bare kv pairs throughout.
- **Errors go under `"err"`.** Reserve `"error"` for a field that is itself named `error` in an external contract (e.g. the OAuth callback's `error` query param).
- **Messages are lowercase and scoped** — `"auth: session user lookup failed"`, `"verify-email: consume token failed"`. Scope-prefix when the package has several flows.
- **Levels:** `Error` for a failed operation, `Warn` for degraded-but-handled, `Info` for key state changes. Prod runs at Info — `Debug` is dev-only.

What a 500 may reveal to the client is covered in § Validation and errors; it is not repeated here.

## IDOR and access

See `security-principles.md` for the stack-agnostic IDOR/token/validation principles this section implements.

- **Every sqlc query is scoped by the session user**, taken from `middleware.CurrentUserID(ctx)` — never from a path, body, or query value. This is the rule with no exceptions.
- `cmd/api/security_guard_test.go` is a default-deny gate: an operation is either secured or on the reviewed `publicOperations` allowlist. It must stay green. Adding a secured op to the allowlist to make a test pass is never the fix.
- Rate-limit buckets live in `internal/ratelimit` as `Bucket*` constants. Add one only where parity or a real abuse surface justifies it.

## Data access

- **Writes are single multi-CTE statements** (insert/update, connect-or-create tags, relink collections, `RETURNING`) — one interface method, fakeable, no transaction plumbing.
- **Reads use keyset (row-value) pagination**, fetching N+1 to derive `hasMore`.
- sqlc owns `internal/db` (generated from `backend/db/queries/**` via `backend/sqlc.yaml`) — never hand-edit it; regenerate.
- goose owns all schema changes, migrations in `backend/db/migrations/` (a real directory, never a symlink into `prisma/`), embedded via `backend/db/embed.go`.

## Testing

Stdlib `testing`, table-driven — `t.Run` per case, `t.Parallel()`, `t.Cleanup()`.

- **Assertions:** stdlib plus `google/go-cmp` (`cmpopts.IgnoreFields` for generated columns, `EquateApproxTime` for timestamps). **Do not import `testify` or Ginkgo.** `testify` appears in `go.mod` as an *indirect* dependency because `humatest` itself uses it — that is not a precedent for importing it directly.
- **In-memory fakes are the default** — hand-written, map-backed, in-package (see `fakes_test.go` in `internal/items` / `internal/collections`).
- **When you need to assert call sequence or arity at an external boundary** (OAuth exchange, Resend, S3, Stripe), use gomock there and only there. Everything else stays a fake. *(No gomock instance exists yet as of Phase 2 — Phase 3 will be the first.)*
- **Handler tests** run in-process via Huma's `humatest`.
- **Time and concurrency** use `testing/synctest` — see `internal/session`, `internal/ratelimit`.
- **Real-SQL integration** uses `testcontainers-go` Postgres (`postgres:17-alpine`, `WithSnapshot`/`Restore`, pgx). **Never** point a test at the shared Neon `dev` branch.
- **When you add a benchmark**, drive it with `testing.B.Loop`, not a hand-rolled `b.N` loop. *(No benchmarks exist yet.)*

**Coverage is gated in CI** by `backend/.testcoverage.yml` — read it rather than restating its numbers. Two things worth knowing before you chase a number: the `internal/auth` override is anchored (`^internal/auth$`), so it is a **package aggregate**, not a per-file bar — per-file was deliberately abandoned because the drift forced repeated coverage-only follow-up passes. Generated code (`internal/db`, `*.sql.go`, `*_mock.go`) is excluded.
