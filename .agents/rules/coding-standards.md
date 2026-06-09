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
- Lib: domain and infrastructure under `src/lib/` — use the matching subfolder, not a flat root file:
  - `src/lib/db/` — Prisma data access (all `prisma.*` calls except `auth.ts` adapter exception)
  - `src/lib/billing/` — Stripe billing, subscriptions, webhooks, checkout
  - `src/lib/api/` — `apiRoute`, `ApiResponse`, `apiFetch`
  - `src/lib/auth/` — auth service, tokens, pending OAuth link
  - `src/lib/infra/` — logger, prisma client, redis, rate-limit, cache, resend
  - `src/lib/storage/` — file uploads (Filebase)
  - `src/lib/stripe/` — Stripe SDK client wrappers
  - `src/lib/app/` — app shell helpers (sidebar data, action utils)
  - `src/lib/editor/` — editor themes and config
  - `src/lib/utils/` — shared constants, formatters, validators (no DB/Stripe)
  - `src/lib/session.ts` — session + action auth helpers (root exception)
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
- Always use `prisma migrate dev` for schema changes (not `db push`)
- Run `prisma migrate status` before committing to verify migrations are in sync
- Production deployments must run `prisma migrate deploy` before the app starts

## Data Fetching

- Server components fetch via `src/lib/db/` helpers (not `prisma.*` inline)
- Client components use Server Actions
- Validate all inputs with Zod

## Code Quality

- Code must comply with ESLint rules. Check and fix linting errors on every attempt of code editing.
- No commented-out code unless specified
- No unused imports or variables
- Keep functions under 50 lines when possible
- Avoid over-decomposition: do not extract a function, component, or file that is only used in one place and adds indirection without benefit. A single-use 3-line helper, a pass-through wrapper component, or a one-export file whose only caller is adjacent are signs of over-decomposition. Inline it instead.

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

- On the back-end side, every important/key step should be logged (e.g., critical state changes, external API calls, webhook events).
- Maintain balance: avoid logging excessive, useless information to prevent logs from becoming unreadable garbage. Use appropriate log levels (`info`, `warn`, `error`).
- Follow a two-part log shape by default; add a third part only when it adds value:
  - First (required): a short, high-signal headline such as an event type or action name.
  - Second (required): the useful extracted data needed for debugging, such as IDs, status values, or event payload fields.
  - Third (optional): a detailed human-readable description when the headline and data alone are not enough — e.g. a Stripe event explanation or external API rationale.
- Keep the headline concise. Do not bury the key event/action in the middle or end of the message.
