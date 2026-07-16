---
trigger: always_on
description: The legacy/new stack boundary for DevStash — which of the three workspaces owns what, src/ is maintenance-only, backend/ is 100% Go, Neon is the database, Prisma is frozen, no cross-stack imports. Always applied, because it binds when deciding where new code goes — before any file exists to trigger on.
---

# Stack Boundary

DevStash runs three workspaces in one repo during the Go+Vite strangler migration. All three share one **Neon (serverless PostgreSQL)** database — now and after the migration; only the client differs. No other database is in play.

| Workspace | Role | Status |
|---|---|---|
| `src/` (Next.js) | Legacy app, still serving the live `devstash.one` apex on Vercel | **Maintenance-only** — bug fixes, security patches; no new features |
| `backend/` (Go) | New API (Huma v2 + sqlc + goose on Cloud Run) | Active development |
| `web/` (Vite SPA) | New frontend (TanStack Start) | Active development |

## Rules

- **`src/` is maintenance-only.** Do not add new features, domains, or endpoints there. A new capability belongs in `backend/` + `web/`, migrated in per the phase plan in `context/current-feature.md`. Bug fixes and security patches in `src/` are still expected until each domain's cutover.
- **Prisma schema is frozen** as of the migration's Phase 0. `prisma migrate dev` may run only if something is still Prisma-side and genuinely needs a schema fix; goose (`backend/db/migrations/`) owns all new schema changes, for both stacks' data. Never `prisma db push`.
- **`backend/` is a 100% Go module.** No `package.json`, npm, or any Node tooling anywhere inside it.
- **`web/` is 100% Vite/TanStack.** `@hey-api/openapi-ts` runs only here; it never touches `src/`.
- **No new cross-stack imports.** `src/` must never import from `web/` or `backend/`, and vice versa. Each workspace has its own dependency graph, build, and deploy pipeline. If logic must be shared, duplicate it deliberately per-stack rather than reaching across the boundary — the stacks are being deliberately decoupled, not merged.
- **Domain-by-domain cutover.** As each backend phase ships (see `context/current-feature.md` for current phase status), the matching `src/app/api/**` handlers and their tests are deleted, and a Vercel edge rewrite points that path prefix at `api.devstash.one`. Do not delete a `src/` domain's handlers before its Go+web replacement has actually shipped and been cut over.
- **Never touch the Neon `production` branch** (`br-royal-poetry-ale2q4pb`). It is the project's **default** branch and is **not** protected, so any MCP call that omits a branch lands on production — always pass `dev` (`br-dry-scene-al1ir5ie`) explicitly. Project `wandering-lab-34213896`. All work — every MCP operation, every local run, either stack — uses **`dev`** unless explicitly told otherwise. Tests never point at `dev` either; the Go suite uses `testcontainers-go` Postgres.

Per-stack standards load automatically when you open a matching file. `context/migration-log.md` has the why behind any migration decision — load it on demand.
