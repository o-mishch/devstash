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

Loaded via `caarlos0/env` in [`internal/config`](internal/config/config.go). Required:
`DATABASE_URL`, `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`,
`AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` (the NextAuth v5 auto-inferred names, shared
verbatim with the existing app — no renames). `PORT` defaults to `8080`; the rest
(S3, Resend, Stripe, OpenAI, Redis) are optional until their phase lands.

## Call it

```bash
curl localhost:8080/health          # -> {"status":"ok"}
curl localhost:8080/openapi.json    # the full OpenAPI spec (source of the frontend's types)
open http://localhost:8080/docs     # SwaggerUI — pick an endpoint and "Try it out"
```

Only `GET /health` exists today; auth / items / collections land in Phase 1+.

## Subcommands

| Command | Purpose |
|---|---|
| `api serve` (or bare `api`) | Start the HTTP server (graceful shutdown on SIGINT/SIGTERM) |
| `api migrate up` / `down` / `status` | Apply / roll back / show goose migrations (needs `DATABASE_URL`) |
| `api openapi emit [file]` | Write the OpenAPI spec to a file (default `openapi.json`). **Offline** — no DB or secrets needed, so CI can generate the contract |

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
scale-to-zero (`min-instances=0`). The image is a static Go binary on alpine (~32 MB).
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
