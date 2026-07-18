---
trigger: glob
globs:
  - src/**/*.ts
  - src/**/*.tsx
paths:
  - "src/**/*.ts"
  - "src/**/*.tsx"
generated:
  - "src/generated/**"
  - "src/types/openapi.ts"
description: Next.js-specific coding standards for DevStash (legacy, maintenance-only) — TanStack Query cache-updater ownership, oxlint type-aware rule specifics, and Pino logging. Loads for files under src/. Stack-agnostic TypeScript rules live in typescript-standards.md; React rules in react.md; Tailwind in tailwind.md; Zustand vs TanStack Query state ownership in legacy-state-management.md; the server/client bundle boundary in legacy-server-client-boundary.md.
---

# Coding Standards (Next.js, legacy)

> `src/` is maintenance-only (see `boundary.md`) — these rules keep the existing app consistent, not a template for new work. New features belong in `backend/` + `web/`. When `context/current-feature.md` describes an in-flight migration that supersedes a rule here, the feature doc wins **for files in that feature's scope only**.

Stack-agnostic TypeScript rules (strict typing, no `any`/double-casts, named interfaces, KISS errors, code-quality/iteration style) live in `typescript-standards.md` and apply here too. Framework-agnostic React rules live in `react.md`. Tailwind v4 rules live in `tailwind.md`.

## TanStack Query cache updaters

> Which state goes in Zustand vs TanStack Query — and the `createContext` ban — are stated in `legacy-state-management.md`. This section covers only where cache **writes** live.

- **TanStack Query cache updaters belong in the hook file, not in components.** Any call to `setQueryData`, `setQueriesData`, or `invalidateQueries` must live in a named exported hook alongside the `useQuery`/`useInfiniteQuery` that owns that cache key. Components call the hook and invoke the returned function — they never call `useQueryClient()` directly.

```typescript
// ✅ correct — updater exported from the hook file
// src/hooks/use-infinite-items.ts
export function usePatchItem() {
  const queryClient = useQueryClient()
  return (id: string, patch: Partial<LightItem>) => {
    queryClient.setQueriesData<InfiniteData<ItemsPage>>({ queryKey: ['items'] }, (old) => { ... })
    void queryClient.invalidateQueries({ queryKey: ['items'], refetchType: 'none' })
  }
}

// component
const patchItem = usePatchItem()
patchItem(item.id, { isFavorite: next })

// ❌ wrong — queryClient used directly in a component
const queryClient = useQueryClient()
queryClient.setQueriesData(...)
queryClient.invalidateQueries(...)
```

## Code Quality (oxlint, `src/`)

- Code must comply with Oxlint rules. Check and fix linting errors on every attempt of code editing.
- **Type-aware linting is on.** `.oxlintrc.json` enables `typescript/*` type-aware rules (via `tsgolint`) at **error** level across `**/*.ts`, `**/*.tsx`, `**/*.mts`. Write code that satisfies these type-checked rules from the start — they are not warnings:
  - `no-floating-promises` — every Promise must be `await`ed, `void`-ed, or `.catch()`-handled. Prefix deliberate fire-and-forget with `void` (e.g. `void queryClient.invalidateQueries(...)`).
  - `no-misused-promises` — no async function where a `void`-returning callback is expected (event handlers, `Array.forEach`, etc.).
  - `await-thenable` / `require-await` — only `await` real thenables; don't mark a function `async` with no `await`.
  - `no-unsafe-*` family (`no-unsafe-assignment`/`-call`/`-member-access`/`-argument`/`-return`) — no `any` flowing through the code. Type external/untyped values as `unknown` and narrow, or wrap them (see the typed test-matcher wrappers `objectContaining`/`arrayContaining`/`stringContaining`/`anything`/`anyOf`/`readJson` in `src/test/matchers.ts`, kept expressly to satisfy `no-unsafe-*` against Vitest's `any`-typed asymmetric matchers).
- `scripts/**/*.{ts,js}` is outside `tsconfig.json`, so the type-aware rules are switched off there — via an `overrides` entry that disables them individually, not a single toggle. `src/generated/**`, `src/types/openapi.ts`, and `prisma.config.ts` are ignored by lint — and of those three, `src/generated/**` and `src/types/openapi.ts` are generated, so never hand-edit or auto-fix them. `prisma.config.ts` is hand-written and merely lint-ignored; it is not generated, and only the two generated paths appear in the `generated:` frontmatter key above.

## Logging

- In Node.js-runtime code, every important/key step should be logged (e.g., critical state changes, external API calls, webhook events).
- Use the root Pino `logger` from `@/lib/infra/pino` — derive a scoped child with `logger.child({ tag })`. No wrappers, no custom logger classes:

```typescript
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'stripe-webhook' })
log.info({ invoiceId, subscriptionId }, 'invoice.paid')
log.error(
  { subscriptionId, err: error },
  'subscription fetch failed — Stripe returned 404, subscription may have been deleted',
)
```

- **Native Pino call convention** — bindings object first, message string second: `log.info({ userId }, 'msg')`. This is the opposite order of the headline-first style used in the Go backend (see `go-coding-standards.md § Logging`); do not carry either order across stacks.
- **`Error` values must be wrapped as `{ err: error }`** so `pino.stdSerializers.err` runs and `err.stack` is preserved. Never pass an `Error` as the message or spread it into the bindings under another key.
- When a module receives an injected logger, type it as `Logger` from `pino` (not `ReturnType<typeof createLogger>`).
- Maintain balance: avoid logging excessive, useless information to prevent logs from becoming unreadable garbage. Use appropriate log levels (`info`, `warn`, `error`).
- Follow a two-part log shape by default; add a third part only when it adds value:
  - First (required): a bindings object holding the useful extracted data needed for debugging — IDs, status values, event payload fields, and any `Error` as `{ err: error }`.
  - Second (required): a short, high-signal message string — an event type or action name.
  - Optional: fold a detailed human-readable explanation into the message when the data alone is not enough — e.g. a Stripe event explanation or external API rationale.
- Keep the message concise. Do not bury the key event/action in the middle or end of the message.
