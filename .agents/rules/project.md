---
trigger: glob
globs:
  - src/**/*
  - web/**/*
  - backend/**/*
  - prisma/**/*
paths:
  - "src/**/*"
  - "web/**/*"
  - "backend/**/*"
  - "prisma/**/*"
description: DevStash's immutable item types and the per-workspace entry commands. Loads when touching code in any of the three workspaces — deliberately NOT always-on, because none of it binds until you open a file. The stack boundary and the database live in boundary.md (always-on).
---

# DevStash

A developer knowledge hub: one fast, searchable place for snippets, prompts, commands, notes, files, images, and links.

## Item types (system, immutable)

`snippet` · `prompt` · `command` · `note` · `file` · `image` · `link`

Never add, rename, or remove a type. `file` and `image` are Pro-only. Legacy icons/colors are in `src/lib/utils/constants.ts`; the new SPA's are in `web/src/lib/item-types.ts` — the two are deliberately kept in sync by value.

## Commands

| Workspace | Run |
|---|---|
| Both (dev) | `task dev` — Go backend (air) + Vite frontend in parallel |
| `src/` (legacy Next.js) | `npm run dev` · `npm run build` · `npm run lint` (oxlint) · `npm run test:run` (Vitest) |
| `backend/` (Go) | `task -d backend check` — the full gate (lint + test + vet) |
| `web/` (Vite SPA) | `npm run dev` · `npm run build` · `npm run typecheck` · `npm run lint` (oxlint) |

`web/` has **no test runner** and must not get one — see `web-architecture.md`.

Data-access mechanics are per-stack: `legacy-database.md` (Prisma, `src/lib/db/`) and `go-coding-standards.md § Data access` (sqlc/goose).
