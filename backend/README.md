# DevStash Go backend

The Go API service for DevStash. A single Cobra binary (`cmd/api`) with `serve`,
`migrate`, and `openapi` subcommands, built on [Huma v2](https://huma.rocks/) over
chi/`net/http`, talking to Neon Postgres via pgx. Part of the ongoing
backend rewrite — see [`context/current-feature.md`](../context/current-feature.md).

100% Go: no `package.json`, no Node tooling anywhere in this tree.

## Prerequisites

- **Go 1.26+** (see `go.mod`)
- Optional, for the task runner: [`task`](https://taskfile.dev)

Dev tools (`air`, `sqlc`, `golangci-lint`) are **pinned in-repo** — no manual install.
None of them live in the production `go.mod`: their heavy dependency trees (sqlc alone
drags in Hugo, the TiDB SQL parser, wazero, cel-go…) would otherwise bloat the production
module graph, `go.sum`, and the Docker `go mod download`. Instead they sit in isolated
tool modules run via `go tool -modfile=…`:

- `air` + `sqlc` → `tools/go.mod` (`go tool -modfile=tools/go.mod air|sqlc …`)
- `golangci-lint` → `golangci-lint/go.mod` (kept separate — its version is pinned to the
  CI action; its ~200-package linter tree stays isolated)

The `task` targets below wrap all three. Do **not** add a repo-root `go.work` — workspace
mode is incompatible with `-modfile` and breaks every tool invocation above.

### Maintaining a tool module's `go.sum`

If a tool run fails with `missing go.sum entry for module …` (its dependency tree pulls
transitive packages not yet recorded — sqlc in particular drags in cel-go, the TiDB parser,
and grpc), complete the sums with `go mod download`, **not** `go mod tidy`:

```bash
go mod download -modfile=tools/go.mod all     # ✅ materializes every sum in the tool graph
```

Do **not** run `go mod tidy -modfile=tools/go.mod`: these tool modules contain no `.go`
files, so `tidy` scans the app packages (`internal/*`, `db/`) against the tool module and
errors on the local imports — the wrong tool for the job. `download` only writes `go.sum`
and never touches the `tool` directive or `require` block.

## Run it locally

From `backend/`, pick one:

```bash
# hot-reload dev loop (air is pinned via go tool) — or from the repo root: task backend:dev
task dev

# no task runner — plain Go:
go run ./cmd/api serve        # or just `go run ./cmd/api` (bare invocation defaults to serve)

# build once, then run the binary:
go build -o api ./cmd/api && ./api serve
```

In development the service auto-loads `.env` / `.env.local` from the **repo root**
(the same file Next.js uses — no renamed keys), so your existing vars are picked up.

### Two gotchas

- **Port 8080 must be free.** Override with `PORT`: `PORT=8081 go run ./cmd/api serve`.
- **`serve` connects to the DB on boot** and exits if it can't — so `DATABASE_URL`
  must point at a reachable database. In production (`ENV=production`) dotenv loading
  is skipped and every required var must be injected by the platform.

### Required config

Loaded via `caarlos0/env` in [`internal/config`](internal/config/config.go). Truly
required: `DATABASE_URL` and `REDIS_URL` (sessions, rate-limit, one-time tokens all
hard-depend on Redis). `AUTH_SECRET` / `AUTH_GITHUB_*` / `AUTH_GOOGLE_*` are read but
not required yet (OAuth isn't built). `PORT` defaults to `8080`. Two dev-convenience
toggles worth knowing when exercising the auth flows below:

- `DISABLE_EMAIL_VERIFICATION=true` — skip the verify-email step entirely (accounts
  are auto-verified on register, and no outbound email is sent at all).
- Without it, a real `RESEND_API_KEY` + `EMAIL_FROM` send real verification/reset
  emails — grab the token from the emailed link's `?token=` query param.

## Call it

```bash
curl localhost:8080/health          # -> {"status":"ok"}
curl localhost:8080/openapi.json    # the full OpenAPI spec (source of the frontend's types)
open http://localhost:8080/docs     # SwaggerUI — pick an endpoint and "Try it out"
```

## Auth endpoints (Phase 1)

All bodies are JSON (`Content-Type: application/json`). The session is an opaque
httpOnly cookie (`devstash_session`, Redis-backed via scs) — no bearer token yet.

| Method | Path                        | Auth           | Body                                     | Success                          |
| ------ | --------------------------- | -------------- | ---------------------------------------- | -------------------------------- |
| POST   | `/auth/register`            | —              | `name, email, password, confirmPassword` | `200 {redirectTo}`               |
| POST   | `/auth/verify-email`        | —              | `token`                                  | `204`                            |
| POST   | `/auth/resend-verification` | —              | `email`                                  | `204` (always, enumeration-safe) |
| POST   | `/auth/login`               | —              | `email, password`                        | `204` + `Set-Cookie`             |
| GET    | `/auth/session`             | session cookie | —                                        | `200 {user, expires}`            |
| POST   | `/auth/logout`              | session cookie | —                                        | `204`                            |
| POST   | `/auth/forgot-password`     | —              | `email`                                  | `200 {redirectTo}` (always)      |
| POST   | `/auth/reset-password`      | —              | `token, password, confirmPassword`       | `204`                            |
| POST   | `/auth/confirm-login-email` | —              | `token, password?, confirmPassword?`     | `204`                            |

### Try the full flow: register → verify → login → session → logout

```bash
BASE=http://localhost:8080
# against the deployed API instead: BASE=https://api.devstash.one
# (running against prod for real? `source .env._production` first for matching
# RESEND_API_KEY / DATABASE_URL etc. if you're also driving it from local scripts)

# 1. Register
curl -s -X POST "$BASE/auth/register" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Ada Lovelace","email":"ada@example.com","password":"correct-horse","confirmPassword":"correct-horse"}'
# -> 200 {"redirectTo":"/register?pending=1&email=ada%40example.com&sent=1"}
# (with DISABLE_EMAIL_VERIFICATION=true: {"redirectTo":"/sign-in"} — account is already
# verified, so skip straight to step 3)

# 2. Verify email — take `token` from the emailed link's ?token= query param
curl -s -X POST "$BASE/auth/verify-email" \
  -H 'Content-Type: application/json' \
  -d '{"token":"https://api.devstash.one/verify-email?token=accf86aa6216696c980b7a37a09985a240b7a01155c5c754c9383534e1fb11e3"}'
# -> 204

# 3. Log in — -c writes the session cookie to a local jar file
curl -s -i -c cookies.txt -X POST "$BASE/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com","password":"correct-horse"}'
# -> 204, Set-Cookie: devstash_session=...

# 4. Get the current session — -b sends the cookie back
curl -s -b cookies.txt "$BASE/auth/session"
# -> 200 {"user":{"id":"...","email":"ada@example.com","name":"Ada Lovelace","image":null,"isPro":false},"expires":"..."}

# 5. Log out
curl -s -i -b cookies.txt -X POST "$BASE/auth/logout"
# -> 204, cookie cleared
```

### Password recovery and other flows

```bash
# Request a reset link (always 200, regardless of whether the account exists)
curl -s -X POST "$BASE/auth/forgot-password" \
  -H 'Content-Type: application/json' -d '{"email":"ada@example.com"}'

# Apply it with the token from the emailed link
curl -s -X POST "$BASE/auth/reset-password" \
  -H 'Content-Type: application/json' \
  -d '{"token":"<token>","password":"new-correct-horse","confirmPassword":"new-correct-horse"}'

# Re-send a verification email (rate-limited, enumeration-safe — always 204)
curl -s -X POST "$BASE/auth/resend-verification" \
  -H 'Content-Type: application/json' -d '{"email":"ada@example.com"}'

# Confirm a credential-email change/add link (password only required when adding
# sign-in to an OAuth-only account, not when changing an existing one)
curl -s -X POST "$BASE/auth/confirm-login-email" \
  -H 'Content-Type: application/json' -d '{"token":"<token>"}'
```

## Subcommands

| Command                              | Purpose                                                                                                                           |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `api serve` (or bare `api`)          | Start the HTTP server (graceful shutdown on SIGINT/SIGTERM)                                                                       |
| `api migrate up` / `down` / `status` | Apply / roll back / show goose migrations (needs `DATABASE_URL`)                                                                  |
| `api openapi emit [file]`            | Write the OpenAPI spec to a file (default `openapi.json`). **Offline** — no DB or secrets needed, so CI can generate the contract |

## Migrations

goose owns all schema changes from `db/migrations/`; the `.sql` files are **embedded
into the binary** (`db/embed.go`), so the compiled service is self-contained. Prisma
migrations are frozen during the rewrite. See [`db/README.md`](db/README.md) for the
baseline and the "mark already-applied" procedure.

## Test & lint

```bash
go test -race ./...                             # unit + parity tests   (task backend:test)
go tool -modfile=golangci-lint/go.mod golangci-lint run   # v2 config in .golangci.yml   (task backend:lint)
gofmt -l .                                      # must be empty
```

CI runs the same on every PR touching `backend/**` (`.github/workflows/backend-ci.yml`).
The CI `golangci-lint` version is **derived from `golangci-lint/go.mod`** (single source of
truth — no manual sync), and CI additionally runs `golangci-lint fmt --diff` and `govulncheck`.

## Deploy

Google Cloud Run, built from `Dockerfile` via Cloud Build (build context `/backend`),
scale-to-zero (`min-instances=0`). The runtime image is a static Go binary on
`gcr.io/distroless/static-debian12:nonroot` (CA certs + tzdata + nonroot, no shell).
`PORT` is injected by Cloud Run; health probe hits `/health`.

## Layout

```
cmd/api/            Cobra entrypoint (serve / migrate / openapi)
internal/config/    env-driven config (caarlos0/env)
internal/postgres/  pgx connection pool (postgres.Connect)
internal/logging/   structured slog logger (logging.New)
db/migrations/      goose SQL migrations (embedded via db/embed.go)
db/queries/         sqlc query sources (from Phase 1)
tools/              isolated go.mod pinning air + sqlc (kept out of the production graph)
golangci-lint/      isolated go.mod pinning golangci-lint as a tool (not a code package)
```
