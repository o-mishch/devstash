---
trigger: always_on
description: Language-level standards for DevStash — TypeScript, React, Tailwind v4, naming, styling, code quality, errors, and logging. Always applied. Next.js architecture and the server/client boundary live in nextjs-architecture.md (glob); data-access rules in database.md (glob); API contract and testing rules load for their file types.
---

# Coding Standards

> These are the standing rules. When `context/current-feature.md` describes an in-flight migration that supersedes a rule here, the feature doc wins **for files in that feature's scope only** — update this doc once the migration lands. Architecture/boundary rules live in `nextjs-architecture.md`; database rules in `database.md`.

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

- **Native Pino call convention** — bindings object first, message string second: `log.info({ userId }, 'msg')`. This is the opposite order of the headline-first style; do not pass the message first.
- **`Error` values must be wrapped as `{ err: error }`** so `pino.stdSerializers.err` runs and `err.stack` is preserved. Never pass an `Error` as the message or spread it into the bindings under another key.
- When a module receives an injected logger, type it as `Logger` from `pino` (not `ReturnType<typeof createLogger>`).
- Maintain balance: avoid logging excessive, useless information to prevent logs from becoming unreadable garbage. Use appropriate log levels (`info`, `warn`, `error`).
- Follow a two-part log shape by default; add a third part only when it adds value:
  - First (required): a bindings object holding the useful extracted data needed for debugging — IDs, status values, event payload fields, and any `Error` as `{ err: error }`.
  - Second (required): a short, high-signal message string — an event type or action name.
  - Optional: fold a detailed human-readable explanation into the message when the data alone is not enough — e.g. a Stripe event explanation or external API rationale.
- Keep the message concise. Do not bury the key event/action in the middle or end of the message.
