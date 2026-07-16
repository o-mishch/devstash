---
trigger: glob
globs:
  - src/**/*.ts
  - src/**/*.tsx
paths:
  - "src/**/*.ts"
  - "src/**/*.tsx"
description: Next.js routing and layout for DevStash (legacy, maintenance-only) — where each mutation/fetch goes (route-handler client vs Server Actions vs exempt routes), the `?skeleton=true` requirement, and file organization under src/lib. Loads when editing files under src/. The server/client bundle boundary lives in legacy-server-client-boundary.md; state/data-fetching/validation in legacy-state-management.md (both same glob).
---

# Next.js Architecture (legacy)

> `src/` is maintenance-only — see `boundary.md`. Split across three same-glob rules to stay under Antigravity's 12k per-file cap: **this file** (routing, skeletons, file organization), `legacy-server-client-boundary.md` (the `'server-only'` / `'use server'` bundle boundary), and `legacy-state-management.md` (Zustand/TanStack, data fetching, validation). Language-level rules live in `legacy-coding-standards.md`; database rules in `legacy-database.md`.

## Next.js

- Dynamic routes for item/collection pages.

### `?skeleton=true` on every screen (required)

Every **data-backed `(app)` page** must honor a `?skeleton=true` query param by rendering its loading skeleton instead of real content — a manual preview of the `loading.tsx` state, used to design/verify skeletons without throttling. This includes dynamic routes (`/parse/[jobId]`, `/items/[type]`, `/collections/[id]`).

**Scope:** `(app)` data-backed routes only. `(auth)`, `(marketing)`, `/api-docs`, and the static `/upgrade` page have no loading state to preview and are exempt — do not add the param to them.

**Pattern** (matches `dashboard/page.tsx`):

```ts
export default async function FooPage(props: {
  searchParams: Promise<{ skeleton?: string }>   // (merge with the page's other params)
}) {
  const searchParams = await props.searchParams
  const forceSkeleton = searchParams.skeleton === 'true'
  // ...auth/redirect guards still run...
  if (forceSkeleton) return <FooSkeleton />        // the SAME skeleton loading.tsx renders
  // ...real data fetch + render...
}
```

Rules:
- The skeleton must be the **same** component the route's `loading.tsx` (or layout Suspense fallback) renders — never a second, divergent skeleton.
- `forceSkeleton` is evaluated **after** the auth/ownership guards (`redirect('/sign-in')`, Pro gate) but **before** any heavy data fetch, so the preview never depends on real data and never leaks a protected page to a signed-out user.
- A page that has no skeleton yet must get one (a reusable component, also wired into `loading.tsx`) — "no skeleton" is not an exemption.
- Dynamic-segment pages are included: resolve the param, run guards, then branch on `forceSkeleton` before the snapshot/db read.

### Where each mutation / fetch goes

| Situation                                                                                 | Use                                                                                                                     |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Data read in a Server Component                                                           | `src/lib/db/` helper (not `prisma.*` inline)                                                                            |
| Mutation or data fetch from a client component                                            | a **route handler** via `api` / `$api` (`@/lib/api/client`). **Never** a Server Action, **never** raw `fetch()`/`axios` |
| Webhook, third-party callback, redirect with a specific HTTP status                       | exempt explicit route (using the modern route wrappers) — see `legacy-api-contract.md`                                         |
| Redirect-terminating auth flow that can't be REST (OAuth sign-in, sign-out, account link) | Server Action — the **only** sanctioned use (returns `ActionState` or redirects directly)                               |

The typed route-handler client is the default for all client-driven mutations and reads (full contract in `legacy-api-contract.md`). New code must not add Server Actions for ordinary mutations. A new endpoint is a new `src/app/api/<domain>/.../route.ts` + a `paths.ts` declaration + schemas, then `npm run openapi:gen` — not a Server Action and not a hand-edited generated type.

> **Client API:** `@/lib/api/client` exports `api` (openapi-fetch — `await api.POST('/path', { body, params })` → `{ data, error, response }`, never throws) and `$api` (openapi-react-query hooks).
>
> **Exempt route wrappers** use the same modern wrappers (`authedRoute`, `authedRouteWithParams`, `publicRoute`) from `@/lib/api/route` and return standard JSON or redirect (`apiRedirect`).

## File Organization

- Components: `src/components/[feature]/ComponentName.tsx`
- Pages: `src/app/[route]/page.tsx`
- Server Actions: `src/actions/[feature].ts`
- Types: `src/types/[feature].ts`
- Lib: domain and infrastructure under `src/lib/` — use the matching subfolder, not a flat root file. **S** = server-only (`'server-only'` required); **C** = shared (client + server safe):
  - `src/lib/db/` **[S]** — Prisma data access (all `prisma.*` calls except `auth.ts` adapter exception)
  - `src/lib/infra/` **[S]** — logger, prisma client, redis, rate-limit, cache, resend, Stripe SDK adapter (`stripe.ts`)
  - `src/lib/auth/` **[S]** — auth service, tokens, pending OAuth link
  - `src/lib/billing/` **[S]** — Stripe billing, subscriptions, webhooks, checkout (domain logic; the raw SDK adapter lives in `infra/stripe.ts`)
  - `src/lib/storage/` **[S]** — file uploads (AWS S3)
  - `src/lib/ai/` **[S]** — OpenAI client + tag/description generation (secret key; pure response parsers are the shared exception)
  - `src/lib/emails/` **[S]** — transactional email senders + templates (Resend via `infra`); all outbound sends go through `sendEmail()` which no-ops when `DISABLE_EMAIL_VERIFICATION=true` (see `legacy-security.md`)
  - `src/lib/services/` **[S]** — app shell helpers (sidebar data, profile action utils)
  - `src/lib/session.ts` **[S]** — session + action auth helpers (root exception)
  - `src/lib/api/route.ts` **[S]** — `authedRoute` / `authedRouteWithParams` / `publicRoute` (route handlers and wrappers)
  - `src/lib/api/http.ts` **[C]** — `json` / `noContent` / `problem` / `parseOr422` Response builders
  - `src/lib/api/schemas/**` **[C]** — bare Zod request/response schemas (browser-safe)
  - `src/lib/api/openapi/**` **[C]** — `paths.ts` + `spec.ts` (OpenAPI doc source)
  - `src/lib/api/client.ts` **[C]** — `api` + `$api` (browser route-handler client)
  - `src/lib/api/query-keys.ts` **[C]** — central TanStack Query key registry (client-only; the FE mirror of the server `CacheTags` boundary — never cross-import)
  - `src/lib/dom/` **[C]** — browser-effect helpers, DOM utilities, Monaco theme — client-only, no secrets
  - `src/lib/storage-client/` **[C]** — client-side S3 upload helpers (`s3-upload-client.ts`, `upload-file-item-client.ts`) — browser XHR with progress tracking, no secret keys
  - `src/lib/utils/` **[C]** — shared constants, formatters, validators (no DB/Stripe)
- Hooks: `src/hooks/<domain>/use-name.ts` — domain folders: `ai/`, `items/`, `billing/`, `profile/`, `editor/`, `ui/`
- Zustand stores (client UI state): `src/stores/[name]-store.ts` — **never** `createContext`

