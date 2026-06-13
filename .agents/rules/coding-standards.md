---
description: TypeScript, React, Next.js, Tailwind v4, database, and code quality standards for DevStash. Loaded at every session start. API contract rules load when editing api/actions files; testing rules load when editing test files.
---

# Coding Standards

## TypeScript

- Strict mode enabled
- No `any` types - use proper typing or `unknown`
- Define interfaces for all props, API responses, and data models
- When a type needs extra fields beyond an existing interface, define a new named interface that `extends` it — do not inline an intersection type on a parameter, return type, or variable:

```typescript
// ✅ correct
interface ApplySubscriptionAccessParams extends ApplySubscriptionStateParams {
  status: Stripe.Subscription.Status | null
  missingFromStripe?: boolean
}

export async function applySubscriptionAccessFromStripe(
  params: ApplySubscriptionAccessParams,
): Promise<SubscriptionAccessApplyOutcome> { ... }

// ❌ wrong
export async function applySubscriptionAccessFromStripe(
  params: ApplySubscriptionStateParams & {
    status: Stripe.Subscription.Status | null
    missingFromStripe?: boolean
  },
): Promise<SubscriptionAccessApplyOutcome> { ... }
```

- Always define a named interface (or type alias) for object shapes — never inline them on parameters, return types, variables, or generic arguments such as `Promise<...>`:

```typescript
// ✅ correct
interface CheckoutSearchParams {
  success?: string
  session_id?: string
  canceled?: string
}

export async function parseCheckoutSearchParams(
  searchParams: CheckoutSearchParams,
): Promise<CheckoutSearchParams> { ... }

// ❌ wrong
export async function parseCheckoutSearchParams(
  searchParams: { success?: string; session_id?: string; canceled?: string },
): Promise<{ success?: string; session_id?: string; canceled?: string }> { ... }
```

- Use type inference where obvious, explicit types where helpful
- Never use `const enum` — incompatible with `isolatedModules: true` (Next.js SWC). Use an `as const` object for dot-notation at call sites, and string literals in the discriminated union type:

```typescript
export const MyActionType = { Foo: 'FOO', Bar: 'BAR' } as const

// Union: use string literals (avoids namespace conflict with the const object)
type MyAction = { type: 'FOO'; payload: string } | { type: 'BAR' }

// Call sites use dot-notation as before:
dispatch({ type: MyActionType.Foo, payload: '...' })
```

## React

- Functional components only (no class components)
- Use hooks for state and side effects
- Keep components focused - one job per component
- Extract reusable logic into custom hooks
- Always define an explicit named interface for component props — never inline prop types
- No nested ternary operators — extract to a variable, early return, or a small focused component instead
- Never use `React.` namespace prefix — import named types/hooks directly (e.g. `MouseEvent` not `React.MouseEvent`)
- Avoid `window.` access — prefer DOM APIs, Next.js router, or React patterns. Only use `window` when there is no framework-level alternative and the browser global is genuinely required (e.g. `window.location` for hard redirects outside React). Always justify the usage in a comment if it is not self-evident.
- Avoid direct `document.` manipulation — prefer React refs (`useRef`), event handlers, or library abstractions. Only use `document.` when no React or Next.js alternative exists (e.g. programmatically triggering a file download via a temporary anchor). Always justify the usage in a comment if it is not self-evident.
- **State management**: use Zustand for UI state (drawer open/close, user flags, modal visibility); use TanStack Query for server state (items, collections, paginated data). Do not create new React Context providers — all UI state is covered by the existing stores in `src/stores/`.
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

```tsx
// ✅ correct
interface SidebarProps {
  onClose?: () => void
}
export function Sidebar({ onClose }: SidebarProps) { ... }

// ❌ wrong
export function Sidebar({ onClose }: { onClose?: () => void }) { ... }
```

## Next.js

- Server components by default
- Only use `'use client'` when needed (interactivity, hooks, browser APIs)
- Use Server Actions for form submissions and simple mutations
- Use API routes when you need:
  - Webhooks (Stripe, GitHub, etc.)
  - File uploads with progress tracking
  - Long-running operations
  - Specific HTTP status codes or headers
  - Endpoints for future mobile/CLI clients
  - Third-party integrations
- Otherwise, fetch data directly in server components
- Dynamic routes for item/collection pages

## Server / Client Boundary

Next.js runs code in two runtimes: the Node.js server and the browser. Server Components and Server Actions are **frontend primitives** — they are part of the React component model and happen to run server-side. The boundary that matters here is the **browser bundle**: modules that use Node.js APIs or secret env vars must never end up in the client bundle.

### `'server-only'` guard

`'server-only'` is a bundler guard, not an architectural label. Add it as the **first line** of any module that uses Node.js APIs, secret env vars, or should never be shipped to the browser. This makes the Next.js bundler throw a build error if a client file accidentally imports it.

| Folder / File | Why |
|---|---|
| `src/lib/db/` | Prisma queries + `'use cache'` — never safe in a browser bundle |
| `src/lib/infra/` | Redis, Prisma client, rate-limit, logger, resend, cache — Node.js / server env |
| `src/lib/auth/` | bcrypt, crypto, DB user helpers — requires Node.js and secret env vars |
| `src/lib/billing/` | Stripe SDK, webhooks, subscription logic — secret keys, Node.js only |
| `src/lib/storage/` | Cloudflare R2 uploads — secret keys, Node.js only |
| `src/lib/stripe/` | Stripe SDK client — secret key |
| `src/lib/app/` | App shell data fetchers (sidebar, action utils) — DB / session access |
| `src/lib/session.ts` | Session helpers — reads cookies / auth, Node.js only |
| `src/lib/api/index.ts` | Route wrappers — `NextRequest` / `NextResponse`, Node.js only |

```typescript
// ✅ correct — first line of any server-only module
'server-only'

import { prisma } from '@/lib/infra/prisma'
```

### Shared modules (no `'server-only'`)

| Folder / File | Why safe |
|---|---|
| `src/lib/utils/` | Pure TypeScript — constants, formatters, validators, no secret env vars |
| `src/lib/editor/` | Monaco config / themes — used in client editor components |
| `src/lib/api/api-fetch.ts` | HTTP client (axios) — browser and Node.js safe |
| `src/lib/api/api-response.ts` | `ApiBody` type helpers — shared by FE and BE |
| `src/types/` | Type definitions only |
| `src/stores/` | Zustand stores — client state, no server imports |
| `src/hooks/` | React hooks — client-only by design |
| `src/components/` | React components — RSC or `'use client'` |

### Server Actions

Server Actions (`src/actions/`) are bound to the server at runtime by Next.js. Do **not** add `'server-only'` to action files — client components must be able to import them for mutations.

### Never import Node.js-only modules from client files

A `'use client'` file must never import from `src/lib/db/`, `src/lib/infra/`, `src/lib/auth/`, `src/lib/billing/`, `src/lib/storage/`, `src/lib/stripe/`, `src/lib/session.ts`, or `src/lib/api/index.ts`.

```typescript
// ✅ correct — client component calls a server action
'use client'
import { createItemAction } from '@/actions/items'

// ❌ wrong — client component imports server-only module directly
'use client'
import { prisma } from '@/lib/infra/prisma'
import { getItems } from '@/lib/db/items'
```

## Tailwind CSS v4

**CRITICAL**: We are using Tailwind CSS v4, which uses CSS-based configuration.

- **DO NOT** create `tailwind.config.ts` or `tailwind.config.js` files (those are for v3)
- All theme configuration must be done in CSS using the `@theme` directive in `src/app/globals.css`
- Use CSS custom properties for colors, spacing, etc.
- No JavaScript-based config allowed

Example v4 configuration:

```css
@import "tailwindcss";

@theme {
  --color-primary: oklch(50% 0.2 250);
}
```

## File Organization

- Components: `src/components/[feature]/ComponentName.tsx`
- Pages: `src/app/[route]/page.tsx`
- Server Actions: `src/actions/[feature].ts`
- Types: `src/types/[feature].ts`
- Lib: domain and infrastructure under `src/lib/` — use the matching subfolder, not a flat root file. **S** = server-only (`'server-only'` required); **C** = shared (client + server safe):
  - `src/lib/db/` **[S]** — Prisma data access (all `prisma.*` calls except `auth.ts` adapter exception)
  - `src/lib/infra/` **[S]** — logger, prisma client, redis, rate-limit, cache, resend
  - `src/lib/auth/` **[S]** — auth service, tokens, pending OAuth link
  - `src/lib/billing/` **[S]** — Stripe billing, subscriptions, webhooks, checkout
  - `src/lib/storage/` **[S]** — file uploads (Cloudflare R2)
  - `src/lib/stripe/` **[S]** — Stripe SDK client wrappers
  - `src/lib/app/` **[S]** — app shell helpers (sidebar data, action utils)
  - `src/lib/session.ts` **[S]** — session + action auth helpers (root exception)
  - `src/lib/api/index.ts` **[S]** — `apiRoute` route wrappers
  - `src/lib/api/api-response.ts` **[C]** — `ApiResponse` builders (shared by FE and BE)
  - `src/lib/api/api-fetch.ts` **[C]** — `apiFetch` HTTP client
  - `src/lib/editor/` **[C]** — editor themes and config
  - `src/lib/utils/` **[C]** — shared constants, formatters, validators (no DB/Stripe)
- Context definitions (`createContext`, hooks, reducers, types — no JSX): `src/context/[name]-context.tsx`
- Provider components (React components that render `<Context.Provider>`): `src/providers/[name]-provider.tsx`

## Naming

- Components: PascalCase (`ItemCard.tsx`)
- Files: Match component name or kebab-case
- Functions: camelCase
- Constants: SCREAMING_SNAKE_CASE
- Types/Interfaces: PascalCase (no prefix)

## Styling

- Tailwind CSS for all styling
- Use shadcn/ui components where applicable
- No inline styles
- Dark mode first, light mode as option
- All `<button>` and `[role="button"]` elements get `cursor: pointer` via the global base layer — do not add `cursor-pointer` on individual components

## Database

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
- Always use `prisma migrate dev` for schema changes (not `db push`)
- Run `prisma migrate status` before committing to verify migrations are in sync
- Production deployments must run `prisma migrate deploy` before the app starts

## Data Fetching

- Server components fetch via `src/lib/db/` helpers (not `prisma.*` inline)
- Client components use Server Actions
- Never use `fetch()` or `axios` directly — always use `apiFetch` from `src/lib/api/api-fetch.ts` for HTTP requests from client code

## Validation

All external inputs (form data, query params, JSON bodies, Server Action arguments) must be validated with Zod before use. Define schemas inline in the action file; extract to `src/lib/utils/validators.ts` only when the same schema is reused by 2+ files.

```typescript
import { z } from 'zod'

const CreateItemSchema = z.object({
  title: z.string().min(1).max(255),
  type: z.enum(['snippet', 'prompt', 'command', 'note', 'link']),
  content: z.string().optional(),
})

export async function createItemAction(_prev: ApiBody<null> | null, formData: FormData) {
  const session = await auth()
  if (!session?.user?.id) return ApiResponse.UNAUTHORIZED()

  const parsed = CreateItemSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return ApiResponse.VALIDATION_ERROR(parsed.error.flatten().fieldErrors)

  // use parsed.data from here on
}
```

## Code Quality

- Code must comply with ESLint rules. Check and fix linting errors on every attempt of code editing.
- No commented-out code unless specified
- No unused imports or variables
- Keep functions under 50 lines when possible
- Avoid over-decomposition: do not extract a function, component, or file that is only used in one place and adds indirection without benefit. A single-use 3-line helper, a pass-through wrapper component, or a one-export file whose only caller is adjacent are signs of over-decomposition. Inline it instead.
- **Prefer modern array methods over imperative loops** for synchronous iteration. Use `.map()`, `.filter()`, `.flatMap()`, `.forEach()`, `.reduce()`, `.find()`, `.some()`, `.every()` instead of `for`, `for...of`, or `while`. Exception: use `for...of` when you need `await` inside the loop body — `await` inside `.forEach` / `.map` does not behave correctly.

### Errors (KISS)

- **Do not create custom `Error` subclasses** (`class FooError extends Error`, dedicated `name` strings, `instanceof` chains). They add types, files, and branching for little gain.
- Throw the built-in `Error` with a clear message. Handle outcomes at the boundary that needs them (e.g. return the right HTTP status in a route, map to `ApiResponse` in `apiRoute`).
- Do not use `instanceof` or `error.name` to route control flow across layers. Prefer return values, result types, or a single catch at the handler edge.
- Exception: framework or library types you do not own (e.g. `ZodError`, `Stripe.errors.StripeError`) — use those as documented.

```typescript
// ✅ correct — plain Error; route catch returns 500 so Stripe retries
throw new Error(`invoice.paid could not fetch subscription ${subscriptionId}`)

// ❌ wrong — custom error class + instanceof / error.name routing downstream
export class MyRetryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MyRetryError'
  }
}
if (error instanceof MyRetryError) throw error
if (err instanceof Error && err.name === 'MyRetryError') { /* skip log */ }
```

## Logging

- In Node.js-runtime code, every important/key step should be logged (e.g., critical state changes, external API calls, webhook events).
- Use `createLogger` from `@/lib/infra/logger` — no wrappers, no custom logger classes:

```typescript
const log = createLogger('stripe-webhook')
log.info('invoice.paid', { invoiceId, subscriptionId })
log.error('subscription fetch failed', { subscriptionId }, 'Stripe returned 404 — subscription may have been deleted')
```

- Maintain balance: avoid logging excessive, useless information to prevent logs from becoming unreadable garbage. Use appropriate log levels (`info`, `warn`, `error`).
- Follow a two-part log shape by default; add a third part only when it adds value:
  - First (required): a short, high-signal headline such as an event type or action name.
  - Second (required): the useful extracted data needed for debugging, such as IDs, status values, or event payload fields.
  - Third (optional): a detailed human-readable description when the headline and data alone are not enough — e.g. a Stripe event explanation or external API rationale.
- Keep the headline concise. Do not bury the key event/action in the middle or end of the message.
