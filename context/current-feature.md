# Current Feature: Backend → Go + Frontend → Vite SPA (Full Rewrite)

## Status
In Progress

## Goals

### Structural / repo-wide (all phases)
- `backend/` directory exists at repo root with a Go module (`go.mod`), a single Cobra binary (`cmd/api/main.go`) with `serve`, `migrate`, and `openapi` subcommands, and zero `package.json`/Node files anywhere inside it
- `web/` directory exists at repo root as a Vite + TanStack Router SPA; `openapi-typescript` runs only inside `web/`, not in `backend/`
- A root `Taskfile.yml` exists with a `task dev` command that starts both `air` (Go hot-reload) and `vite dev` concurrently via sub-Taskfiles
- `src/app/api/` route handlers are deleted domain-by-domain as each Backend Track phase completes; `src/app/(auth)/`, `(app)/`, `(marketing)/` pages deleted as each Frontend Track phase completes; `src/` is fully deleted when Phase 6 + F3 finish
- `prisma/schema.prisma` and `prisma/migrations/` are frozen (no new changes) from Phase 0 onward; goose owns all schema migrations from `backend/db/migrations/`

### Phase 0 — Go skeleton + CI/deploy scaffolding
- `backend/` contains a working Go module with Huma v2 on `net/http` (chi router via `humachi`, kept for its middleware ecosystem — request-id, recovery, real-ip), serving `GET /health` (200) and SwaggerUI at `/docs`
- `golangci-lint` and `go test ./...` run in CI (`.github/workflows/`) for the `backend/` tree
- Google Cloud Run auto-deploy is connected to `backend/` (**Dockerfile** build via Cloud Build; scale-to-zero / `min-instances=0`; `api.devstash.one` custom domain, `/health` probe); the service returns 200 at `/health`. Runtime image is a static Go binary on alpine (~32 MB). The binary still defaults to `serve` on bare launch (robustness); goose migrations are embedded so the image ships no loose files.
- A goose baseline migration exists at `backend/db/migrations/` representing the current Neon schema as-applied, marked as already-applied against the Neon `dev` branch (not replayed)
- `backend/internal/config/` contains a `caarlos0/env` config struct with struct tags matching existing `.env` variable names (no renames); Go service loads from the shared repo-root `.env`/`.env.local` via `godotenv`

### Phase 1 — Auth/session foundation (blocks both tracks)
- `backend/internal/auth/` implements login, register, OAuth start/callback (GitHub + Google), session issuance, and legacy NextAuth v5 JWE cookie decode (go-jose + hkdf); `src/app/api/auth/` route handlers are deleted
- Go issues a single `scs`+pgx session cookie (`Domain=.devstash.one`, `SameSite=Lax`, `Secure`) that reads/writes existing `sessions`/`users`/`accounts` rows via sqlc
- `GET /auth/session` endpoint exists and is the SPA's client-side auth check

### Frontend Track F0 (depends on Phase 1)
- `web/` is a Vite + TanStack Router + TanStack Query + Zustand project; `vite.config.ts` proxies `/api/*` to the local Go server
- A root layout in `web/src/` contains a client-side auth guard that calls `GET /auth/session`; protected routes 401-redirect to sign-in; `src/middleware.ts` (Next.js) is deleted once F0 ships

### Per-phase backend cutover pattern (Phases 2–6)
- Each backend phase: Go handlers in `backend/internal/<domain>/` pass parity tests (table-driven with `t.Run` subtests, against narrow consumer-defined interfaces backed by **in-memory fakes** — see the Testing constraints); the corresponding `src/app/api/<domain>/` route handlers and Vitest test files are deleted in the same PR; edge routing rule updated to point that domain's prefix at `api.devstash.one`

### Testing approach (Go-native, all phases)
- **Standard library `testing` is the frame** — table-driven cases in a slice of structs, one `t.Run(tc.name, …)` per case, `t.Parallel()` on independent cases, `t.Cleanup()` over manual teardown. No test framework layered on top (no Ginkgo/Convey).
- **Assertions: stdlib + `google/go-cmp`.** Scalars via `if got != want { t.Errorf(...) }` / `t.Fatal` on setup errors; structs, slices, and maps via `cmp.Diff(want, got)` (readable field-level diff). Use `cmpopts.IgnoreFields` for generated columns (ids, `createdAt`/`updatedAt`) and `cmpopts.EquateApproxTime` for timestamps. No `stretchr/testify` (avoids a second, competing assertion idiom).
- **Test doubles: in-memory fakes by default, gomock only at external boundaries.** Each domain's narrow, consumer-defined interface gets a hand-written fake (small struct with a `map` backing) living in the test package — this is the default for the sqlc data layer and doubles as handler-test scaffolding. Reserve generated gomock mocks for interfaces wrapping collaborators we don't own where call sequence/arity is the thing under test (OAuth token exchange for GitHub/Google, Resend email, S3).
- **Handler tests go through Huma's `humatest`** — `_, api := humatest.New(t)`, register routes, `api.Get`/`api.Post(...)`, assert `resp.Code` and `resp.Body.String()`. In-process, no real socket.
- **Concurrency/time: `testing/synctest`** (stable in Go 1.25 — use `synctest.Test`, not the 1.24 experimental `synctest.Run`) for anything time-dependent: session expiry, OAuth callback deadlines, rate-limit windows. Virtual time, deterministic, no `time.Sleep` in tests.
- **Integration tests that exercise real SQL: `testcontainers-go` Postgres**, never the shared Neon `dev` branch. `postgres.Run(ctx, "postgres:17-alpine", …)` per run with `t.Cleanup(...)` for teardown; use `postgres.WithSnapshot()` + `container.Restore(ctx)` (import the `pgx` stdlib driver so snapshot/restore uses the native driver, not `docker exec`) for a clean DB per case. Keeps the "never mutate Neon during transition" constraint clean and stays parallel-safe.
- **Benchmarks (if any) use `testing.B.Loop`** (Go 1.24+), not the legacy `for i := 0; i < b.N` idiom — auto-excludes setup timing and defeats dead-code elimination. (`b.Loop` is a sanctioned exception to the "no classic for loops" rule in `go-coding-standards.md`.)
- **Coverage is gated in CI (hard-fail).** `backend-ci.yml` Test step emits a profile (`go test -race -covermode=atomic -coverpkg=./... -coverprofile=cover.out ./...`) and `vladopajic/go-test-coverage` (pinned action) enforces `backend/.testcoverage.yml`: **total 70%**, with `internal/auth` held to **85%** (highest-risk surface). Generated code is excluded (sqlc `internal/db`/`*.sql.go`, mockgen `*_mock.go`/`/mocks/`). No SaaS/token — in-repo, matches the `contents: read`-only CI posture.

## Notes

- **Files to touch (Phase 0):**
  - `backend/` — new directory, entire Go module (does not exist yet)
  - `backend/cmd/api/main.go` — Cobra root + subcommands
  - `backend/internal/config/config.go` — caarlos0/env struct
  - `backend/db/migrations/` — goose baseline SQL
  - `backend/Dockerfile` — Cloud Run build via Cloud Build (build context `/backend`)
  - `backend/db/embed.go` — embeds goose migrations into the binary (self-contained; runtime image ships no loose files)
  - `backend/Taskfile.yml` — `air` dev task
  - `web/Taskfile.yml` — `vite dev` task (created alongside F0)
  - `Taskfile.yml` (root) — `task dev` orchestration
  - `.github/workflows/` — add Go lint/test job
  - `infra/` — extend GKE sandbox manifests for Go service (learning-only, no prod impact)

- **Files to touch (Phase 1):**
  - `backend/internal/auth/{session,oauth,login,register,tokens,legacy_cookie}.go`
  - `backend/db/queries/auth.sql` + generated sqlc output
  - `src/app/api/auth/` — deleted once Go auth passes
  - `src/auth.ts`, `src/lib/session.ts`, `src/lib/auth/tokens.ts` — read for parity, then deleted

- **Files to touch (Frontend F0):**
  - `web/src/routes/__root.tsx` — root layout + auth guard
  - `web/src/auth/guard.tsx` — session-check logic
  - `web/src/lib/api/client.ts` — openapi-fetch client pointing at `/api`
  - `web/vite.config.ts` — proxy config
  - `src/middleware.ts` — deleted after F0

- **Utilities to reuse:**
  - Existing `.env` variable names (no renames — Go uses same keys via caarlos0/env)
  - `openapi.json` (existing) as merge input for Go's `api openapi merge` subcommand during transition
  - `src/lib/db/*.ts` files — read end-to-end per phase for sqlc query parity (one sqlc query per exported function, same order)
  - `src/app/api/` route handlers — read for Go handler parity before deletion

- **Out of scope:**
  - Encore.dev (explicitly deferred — stay with Huma + composed libraries)
  - Any Node dependency inside `backend/`
  - `tailwind.config.ts` (Tailwind v4 CSS-based config carries over to `web/`)
  - Schema changes to Neon during the transition period (goose handles all schema changes from Phase 0 onward; Prisma is frozen)
  - Moving `infra/` GKE to production — it stays a $0-idle learning sandbox

- **Constraints:**
  - Never `prisma db push` — use `prisma migrate dev` for anything still Prisma-side during the strangler period; use goose for all new schema changes
  - Never touch the Neon production branch (`br-royal-poetry-ale2q4pb`)
  - `backend/` must be 100% Go — no `package.json`, no npm scripts, no Node tooling anywhere in that tree
  - Domain packages use vertical slices (one file per operation: `create.go`, `list.go`, etc.) — not a shared `service.go` per domain
  - No `authedRoute`/`publicRoute` wrapper pattern in Go — use Huma `Operation.Security` + middleware instead
  - No hand-rolled `problem()`/`json()` helpers — use Huma's native RFC 9457 error responses
  - Narrow, consumer-defined interfaces per domain package (not one global `Querier`) — back these with hand-written in-memory fakes by default; gomock only at external-service boundaries (see the Testing approach section)
  - IDOR: every sqlc query must scope by `userId` from the session, never from user input
  - `window.location.assign` for OAuth start is explicitly justified (no server-side redirect mechanism in the SPA)
  - Start with Phase 0 — do not implement Phase 1+ until Phase 0 is verified (Cloud Run `/health` returns 200)
  - `backend/db/migrations/` is a real directory owned by goose — never a symlink into `prisma/migrations/` (breaks `go:embed`, pollutes the frozen Prisma dir, and is fragile on Windows)
