---
trigger: glob
globs:
  - src/lib/db/**/*
  - prisma/**/*
paths:
  - "src/lib/db/**/*"
  - "prisma/**/*"
description: Database standards for DevStash — Prisma-only data access confined to src/lib/db/, the `'use cache'` + cacheTag/cacheLife pattern, ORM-over-raw-SQL, and migration workflow. Loads when editing src/lib/db/ or prisma/.
---

# Database

> Standing rules for data access. When `context/current-feature.md` describes an in-flight migration that supersedes a rule here, the feature doc wins **for files in that feature's scope only** — update this doc once the migration lands. Architecture/boundary rules live in `nextjs-architecture.md`.

- Use Prisma ORM for all database operations
- All Prisma operations (`prisma.*`) must live in `src/lib/db/` so Server Actions, services, API routes, and server components import data access from one layer rather than calling Prisma directly.
- **Exception — `src/auth.ts` only:** NextAuth requires passing the Prisma client to `PrismaAdapter(prisma)`, which performs adapter-owned reads/writes. Auth callbacks may also run small, auth-specific `prisma.*` calls when they are tightly coupled to the NextAuth lifecycle (e.g. OAuth account backfill in `jwt`). Do not treat this as a general precedent — new database access elsewhere still belongs in `src/lib/db/`. When an auth callback needs non-trivial or reusable logic, add a helper in `src/lib/db/` and call it from `auth.ts`.
- **Prefer ORM queries over raw SQL.** Use `prisma.$queryRaw` only when Prisma has no equivalent (e.g. `groupBy` across relation fields) or when the ORM equivalent would be measurably slower. Every raw SQL call must include a comment explaining why the ORM cannot do the same thing.
- Every function in `src/lib/db/` must use the `'use cache'` directive with `cacheTag` + `cacheLife`. Follow this pattern when adding or editing a DB query function:

```typescript
import { cacheTag, cacheLife } from 'next/cache'
import { CacheTags } from '@/lib/infra/cache'

export async function getItemsByType(userId: string, type: string) {
  'use cache'
  cacheTag(CacheTags.itemsByType(userId, type), CacheTags.itemGroup(userId))
  cacheLife('max')
  return prisma.item.findMany({ where: { userId, type } })
}
```

  Invalidate via the `invalidate*` helpers in `src/lib/infra/cache.ts` — they call `revalidateTag` wrapped in `after()`.
- **Exception — auth/security freshness reads:** Do not cache DB helpers that gate authentication,
  credential/email verification, password state, token-confirmation decisions, or mutation collision
  checks. These reads must reflect the latest committed security state. Keep them in `src/lib/db/`, keep
  the Prisma access centralized, and add a short comment explaining why the helper is intentionally
  uncached when the freshness requirement is not obvious.
- Always use `prisma migrate dev` for schema changes (not `db push`)
- Run `prisma migrate status` before committing to verify migrations are in sync
- Production deployments must run `prisma migrate deploy` before the app starts
