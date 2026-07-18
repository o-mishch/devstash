---
trigger: glob
globs:
  - src/**/*.ts
  - src/**/*.tsx
  - web/**/*.ts
  - web/**/*.tsx
  - .agents/skills/**/*.ts
paths:
  - "src/**/*.ts"
  - "src/**/*.tsx"
  - "web/**/*.ts"
  - "web/**/*.tsx"
  - ".agents/skills/**/*.ts"
description: Stack-agnostic TypeScript conventions shared by both frontends (src/ Next.js and web/ Vite SPA) and the agent skill scripts under .agents/skills/ — strict typing, no any/double-casts, named interfaces, KISS error handling, general code-quality/iteration style. Loads for any .ts/.tsx file in those trees. Framework-specific rules (React, Tailwind, Next.js architecture) live in their own files.
---

# TypeScript Standards

These are the stack-agnostic TypeScript rules — they apply the same way whether the file is under `src/`, `web/`, or `.agents/skills/`. Framework-specific conventions live in `react.md`, `tailwind.md`, `legacy-nextjs-architecture.md`, or `web-architecture.md`.

**Skill scripts (`.agents/skills/**/*.ts`) run on bare `node`** — Node executes TypeScript natively, so there is no tsx, no bundler, and no build step. That imposes two constraints the app workspaces don't have:

- **No dependencies.** No `package.json`, no `node_modules` under `.agents/skills/`. A skill must run on a fresh clone with nothing installed; a skill that can't start is a skill that silently does nothing. Use `node:` built-ins (`node:path`'s `matchesGlob` for globs, `JSON` for data) rather than reaching for a library. The one config file that is allowed is `.agents/skills/tsconfig.json` — it declares no dependencies; it exists only to point the type-aware gates at node's types (see below).
- **Type annotations are stripped, not checked.** `node` erases types without verifying them, so types are documentation until something typechecks them. Erasable syntax only — no `enum`, no parameter properties, no namespaces.

All three gates, run from the repo root:

```bash
node --test .agents/skills/cleanup/scripts/globcheck.ts   # behavior
npx oxlint .agents/skills --disable-nested-config          # lint
node_modules/.bin/tsc --ignoreConfig --noEmit --strict --erasableSyntaxOnly \
  --noUnusedLocals --noUnusedParameters \
  --module nodenext --moduleResolution nodenext --target es2023 \
  --allowImportingTsExtensions --skipLibCheck --types node \
  .agents/skills/**/scripts/*.ts .agents/skills/**/scripts/lib/*.ts
```

`--erasableSyntaxOnly` is the load-bearing flag: it fails on exactly the syntax `node` cannot strip, so a file that passes is a file that runs. `--ignoreConfig` is required because neither the Next.js root `tsconfig.json` nor the oxlint-scoped `.agents/skills/tsconfig.json` (see below) applies to this gate.

`--noUnusedLocals` / `--noUnusedParameters` are the dead-code gate — `--strict` alone does not check unused locals, so without these two a stale import would survive `tsc` while `§ Code Quality` below forbids exactly that.

These scripts **are** linted — by the **root** `.oxlintrc.json`, whose `**/*.ts` glob covers them (they are `.ts`, and are not in its `ignorePatterns`); the `frontend-oxlint` pre-commit hook enforces it. oxlint's type-aware rules need a TypeScript project to resolve `node:` built-ins against — without one, every `assert.equal` / `test()` / `fs.statSync()` resolves to the `error` type and floods `no-unsafe-*`. That is what `.agents/skills/tsconfig.json` is for: it mirrors the `tsc` gate's flags and pulls in `@types/node`, so oxlint type-checks the scripts as node code. Two rules that fight node idioms are relaxed in-code rather than repo-wide: `node:test`'s top-level `test(...)` calls are floated with `void` (that is the sanctioned form for `node --test`), and any bare `.sort()` on strings takes an explicit `localeCompare` comparator.

## Typing

- No `any` types — use proper typing or `unknown`
- **No double type assertions (`as unknown as X` / `as any as X`)** to force an incompatible cast — it bypasses the type checker rather than describing a real type. Find the structurally honest fix first — a real generic instantiation, a type guard, a properly-typed overload, a small runtime adapter — even if it means a larger refactor than the cast. Reserve `as unknown as` only for a genuinely inherent boundary with no honest alternative (an undocumented third-party internal API, a `globalThis` augmentation, a `Json` column) — and say why in a comment:

```typescript
// ✅ correct — two honestly-generic client instances; the type system does the narrowing, no cast
const publicClient = createFetchClient<PublicApiPaths>(clientOptions)
const aiClient = createFetchClient<AiMutationApiPaths>(clientOptions)

// ❌ wrong — double-cast to force one client's type to look like a different, incompatible one
const api = fetchClient as unknown as Client<PublicApiPaths>
```

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
- Never use `const enum` — incompatible with `isolatedModules: true`. Use an `as const` object for dot-notation at call sites, and string literals in the discriminated union type:

```typescript
export const MyActionType = { Foo: 'FOO', Bar: 'BAR' } as const

// Union: use string literals (avoids namespace conflict with the const object)
type MyAction = { type: 'FOO'; payload: string } | { type: 'BAR' }

// Call sites use dot-notation as before:
dispatch({ type: MyActionType.Foo, payload: '...' })
```

## Naming

- Components: PascalCase (`ItemCard.tsx`)
- Files: Match component name or kebab-case
- Functions: camelCase
- Constants: SCREAMING_SNAKE_CASE
- Types/Interfaces: PascalCase (no prefix)

## Code Quality

- No commented-out code — delete it; git has it.
- Avoid over-decomposition: do not extract a function, component, or file that is only used in one place and adds indirection without benefit. A single-use 3-line helper, a pass-through wrapper component, or a one-export file whose only caller is adjacent are signs of over-decomposition. Inline it instead.
- **Prefer modern array methods over imperative loops** for synchronous iteration. Use `.map()`, `.filter()`, `.flatMap()`, `.forEach()`, `.reduce()`, `.find()`, `.some()`, `.every()` instead of `for`, `for...of`, or `while`.
- **Async iteration — pick by whether the work is concurrent or sequential:**

```typescript
// ✅ concurrent — the canonical form; `await` inside `.map` is correct here
const results = await Promise.all(ids.map(async (id) => fetchItem(id)))

// ✅ sequential — when each step depends on the last, or you must not fan out
for (const id of ids) {
  await deleteItem(id)
}

// ❌ wrong — `.forEach`'s callback is `void`-returning, so the promise is discarded:
//    the loop never waits and a rejection surfaces as an unhandled rejection
ids.forEach(async (id) => {
  await deleteItem(id)
})
```

  Never pass an async callback to `.forEach` — a linter's `no-misused-promises` rule (or equivalent) catches this. An async `.map` is only a defect when nothing gathers the resulting `Promise[]`; `Promise.all` (or `allSettled`) makes it correct.

## Errors (KISS)

- **Do not create custom `Error` subclasses** (`class FooError extends Error`, dedicated `name` strings, `instanceof` chains). They add types, files, and branching for little gain.
- Throw the built-in `Error` with a clear message. Handle outcomes at the boundary that needs them.
- Do not use `instanceof` or `error.name` to route control flow across layers. Prefer return values, result types, or a single catch at the handler edge.
- Exception: framework or library types you do not own (e.g. `ZodError`, `Stripe.errors.StripeError`) — use those as documented.

```typescript
// ✅ correct — plain Error; caller decides how to respond
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
