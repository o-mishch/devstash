# Improve — Evaluation Checklist

Five priority lenses, applied across the whole changeset (holistic, not per-file). **KISS = simplicity** (fewer concepts, less indirection, easier to read) — not always fewer lines. **DRY = one source of truth** — always scan P2 for duplication.

| Lens | Name | Asks |
| --- | --- | --- |
| **P1** | Architecture & SOLID | Is logic in the right layer? Would a redesign remove structure? |
| **P2** | KISS & DRY | Can this be deleted, merged, or replaced by an existing util / library idiom? Is there a single source of truth? |
| **P3** | Security & access | Leak, auth bypass, IDOR, or wrong grant/deny at scale? |
| **P4** | Bugs, regressions & logging | Production break, behavior regression, or missing/ noisy logs? |
| **P5** | Convention, hygiene & tests | Project rules (`coding-standards`, `api-contract`), hygiene, test gaps? |

**Be critical — the bar is not "compiles and is clean."** Most changesets carry at least one repeated pattern or simplification; assume so until you have looked across sibling files, callers, and similar code (the WIDEN + PATTERN PASS steps in SKILL.md) to rule it out. `No issues found.` is a strong claim — only make it after that wide pass, and state *what you checked* so the user can trust the zero. Doubt about whether a library offers a leaner API is **not** grounds to pass: resolve it with context7 (`context7-mcp` skill → `mcp__context7__*`) and let the answer drive the finding.

**Finding ID:** `P{n}-{seq}` (e.g. `P2-3`) — assigned per priority, unique within this report; the user references findings by ID. **Output shape:** see the card in `improve/report.md` — that template is the single source for what a rendered finding looks like. While scanning, jot each finding as `[ID] · Major|Minor · path:line · one-line evidence` so the report write-up is mechanical.

---

## P1 — Architecture & SOLID

*Lens: right layer? redesign removes debt?*

| Signal | Look for |
| --- | --- |
| Bundle leak | `'use client'` file imports `lib/db/`, `lib/infra/`, `lib/auth/`, `lib/billing/`, `lib/storage/`, `lib/stripe/`, `lib/session.ts`, or `lib/api/index.ts` — these use Node.js APIs / secret env vars and must not enter the browser bundle |
| Missing guard | Node.js-only module in `lib/db/`, `lib/infra/`, `lib/auth/`, `lib/billing/`, `lib/storage/`, `lib/stripe/`, `lib/app/`, `lib/session.ts`, `lib/api/index.ts` missing `'server-only'` as first line |
| UI owns rules | access checks or input validation in components |
| BE in UI | DB/Stripe calls in components or thin routes |
| Data layer | `prisma.*` outside `src/lib/db/` (except `auth.ts` adapter) |
| Boundaries | fat actions; logic that belongs in `src/lib/` |
| Placement | wrong directory per coding-standards |
| Coupling | circular imports; unrelated modules tightly coupled |
| Redesign | flow spread across too many files; patches leave structural debt |

Major redesign → include: current shape → proposed shape → benefit

---

## P2 — KISS & DRY

**KISS = simplicity.** The simplest correct solution has the fewest concepts, layers, and indirection — not necessarily the fewest lines. More lines can be simpler than a clever one-liner. Every improve run must hunt for simplification wins — not only flag creep.

**DRY = one source of truth.** The same logic, rule, or shape in 2+ places is always a P2 finding. Every improve run must hunt for duplication across changed *and* unchanged files.

*Lens: delete/merge/inline before adding. Prefer clarity over brevity — but eliminate redundancy.* This is the highest-yield lens and where the audit most often under-reports — work it hardest.

| Signal | Look for |
| --- | --- |
| **Repeated pattern** (DRY) | the **same shape** in 2+ files — a guard, a conditional, a data transform, a prop interface, a `fetch`→`map`, an error map. `rg` the codebase (changed *and* unchanged files) for each non-trivial shape in the changeset; 2+ hits → propose one source of truth |
| **Duplicate rule** (DRY) | same rule derived in 2+ places (e.g. an access check, a status derivation, a formatted display value) — collapse to one source |
| **Reinvented idiom** (KISS) | hand-rolled logic a library already gives (React hooks/`use`, Next.js `cache`/`redirect`/route helpers, Prisma `select`/`include`/`groupBy`, Zod refinements, TanStack Query/Virtual, Zustand selectors, shadcn primitives) — **confirm the leaner API via context7 before recommending** |
| Existing util not reused | a helper in `src/lib/utils/` (or sibling module) already does this, but the changeset re-implements it |
| Over-decompose | one-liner wrapper; single-export single-use file; deep import chain |
| Over-engineer | one-impl abstraction; unused generic; premature cache/state machine |
| LOC creep | changeset or prior fixes grew `src/` without removing equivalent code — **always P2** |
| −LOC opportunity | duplicate, dead file, wrapper, over-split module, client→server — **report even if Minor** |
| Additive fix | recommendation only adds lines — **required:** explain why no simpler path exists |
| Growth without payoff | net +LOC for logging/tests/helpers that could be inline or merged |

Every P2 finding: **est. LOC Δ** (show **−N** prominently for cuts, but a complexity reduction with +LOC is still valid). Default fix: merge/delete/inline, or apply the existing util / library idiom. Adding lines needs explicit justification that the result is *simpler*, not just shorter. Surface top simplification and DRY items in report **KISS & DRY** section. A repeated pattern found across the codebase is reported even when only one instance is in the changeset — note the other call sites as the dedupe target.

---

## P3 — Security & access outage

*Lens: leak, auth bypass, wrong deny/grant at scale? (high-level only)*

| Signal | Look for |
| --- | --- |
| Auth | missing session check in action/API/webhook |
| IDOR | `userId` from input not session |
| Input | external data without Zod |
| Tokens | weak/reusable token; missing expiry |
| Password | hash returned to client or logged; password change without verifying the current password |
| Rate limit | new auth-adjacent endpoint unprotected |
| Webhook | no signature verify or idempotency |
| Exposure | secrets, stack traces, internal errors to client |
| Access | stale cache after write; sync/webhook race granting wrong access |
| Outage | external-service/DB error in a layout or shared loader blocks the app; multi-step write race (e.g. checkout↔webhook↔sync) |

Major → row in Security & access risks table (`Fix now`).

---

## P4 — Bugs, regressions & logging

*Bugs lens: production break or behavior regression?*

| Signal | Look for |
| --- | --- |
| Logic | wrong branch; null/empty edge; partial write no rollback |
| Race | multi-step async write (e.g. checkout↔webhook↔sync); stale cache after write |
| Contract | changed API breaks caller in changeset |
| Access | wrong grant/deny; state transition gap |
| Async | missing `await`; floating promise |
| Hydration | client/server boundary bug |
| Tests | weakened/removed assertions |
| Regression | changeset reverts or breaks a behavior that git history / tests show was working |
| Dead end | a user flow (checkout, upgrade, multi-step form) with no recovery path |

Major bug → row in Bugs & regressions table (`Fix now`).

*Logging — coding-standards § Logging; `createLogger('tag')` only, no wrappers*

| Signal | Look for |
| --- | --- |
| Missing | critical state change / API call / webhook not logged |
| Swallowed | error on a critical path (auth, webhook, payment, write) without `log.error` |
| Shape | no headline → context (IDs) → description when useful |
| Noise | excessive low-signal logs; wrong level |
| Wrapper | custom logger around `createLogger` |

---

## P5 — Convention, hygiene & tests

*Cite `coding-standards` § section. Also `api-contract.md` when actions/API in scope.*

| Area | Look for |
| --- | --- |
| TypeScript | inline types; `Foo & {}` on params; `any`; `@ts-ignore`; `const enum` |
| Errors (KISS) | custom `class FooError extends Error`; `instanceof` / `error.name` routing control flow across layers — use plain `Error`, handle at the boundary (framework types like `ZodError` / `Stripe.errors` are exempt) |
| React | class component; inline props; nested ternary; `React.` prefix; direct `window.` / `document.` access without a justifying comment |
| Next.js | see **SSR** below; `'server-only'` missing in server-only modules (see P1 — also flag here if in scope) |
| API | see **API surface** below |
| Database | `prisma.$queryRaw` without a comment explaining why the ORM can't express it; raw SQL where an ORM query exists |
| Naming | not PascalCase component · camelCase fn · SCREAMING_SNAKE const · PascalCase type (no prefix) |
| Styling | `tailwind.config.*`; inline styles; redundant `cursor-pointer` on buttons |
| Quality | commented-out code; unused imports; fn >50 lines; forbidden env vars |
| Hygiene | ESLint; `console.log`; stale TODO; env.d.ts / `.env.example` drift |
| Tests | changed `lib/` (except `lib/db/`, which is exempt) or `actions/` without meaningful test; weak mocks; missing edge cases; no component (`.tsx`) tests |

### API surface — `api.ts` / `api-response.ts` / `api-fetch.ts`

*Lens: `api-contract.md`. JSON and redirects go through project helpers unless strictly justified.*

| Signal | Look for |
| --- | --- |
| Raw JSON response | `NextResponse.json()` in `src/app/api/` — use `ApiResponse` + `apiRoute` |
| Raw redirect | `NextResponse.redirect()` in API routes — use `apiRedirect` + `apiRoute` |
| Unwrapped route | handler exported without `apiRoute` / `authenticatedRoute` |
| Client fetch | `fetch()` / `axios` in client components — use `apiFetch` or Server Action |
| Action shape | Server Action returns bool/string instead of `ApiBody<T>` |
| Action error handling | Server Action with no try/catch returning `ApiResponse.INTERNAL_ERROR()` on unexpected failure |
| Justification missing | raw NextResponse/fetch present without comment explaining why helpers cannot apply |

**Major** — API route bypasses `apiRoute` or returns non-`ApiBody` JSON to clients.  
**Minor** — raw `NextResponse.redirect` where `apiRedirect` works; missing justification comment.

`redirect()` from `next/navigation` in pages/actions is **not** a violation.

### SSR — server vs client boundary

*Lens: server components by default (coding-standards § Next.js). Prefer server; client only for interactivity, hooks, browser APIs. Converting client → server often **−LOC**.*

| Signal | Look for |
| --- | --- |
| Unnecessary client | `'use client'` on display-only UI (no hooks, no handlers, no browser APIs) |
| Fetch on client | `useEffect` + `fetch`/`apiFetch` for data available at render time |
| Thin client shell | client wrapper exists only to receive server props and render children |
| Split for no reason | server page fetches data then passes to identical client child that could be server |
| Form on client | submit handler + `fetch` where Server Action would work |
| Prop drilling boundary | large props blob crossed client boundary when server child could own fetch |
| Hydration risk | `Date.now()`, `Math.random()`, locale/timezone without `suppressHydrationWarning` where needed |
| `'use client'` import leak | client file imports from `lib/db/`, `lib/infra/`, `lib/auth/`, `lib/billing/`, `lib/storage/`, `lib/stripe/`, `lib/session.ts`, `lib/api/index.ts` (also P1 bundle leak — **Major**) |

**Minor** — can convert to server component or Server Action with est. LOC −.  
**Major** — client boundary hides server-only imports or blocks critical server fetch path.

When components are in scope: include **SSR** detail table in report (file · current · can convert? · est. LOC).

---

## Severity

| Major | Minor |
| --- | --- |
| Bug; regression; FE/BE leak; security/access outage; API violation (`apiRoute`/`ApiResponse`/`apiRedirect`/`apiFetch`); repeated pattern / duplicate rule across 2+ files (DRY); swallowed critical error; weak critical-path tests; redesign strongly warranted | KISS / DRY tweak; convention; hygiene; raw `NextResponse.redirect` without justification; unnecessary `'use client'` / client fetch (SSR); non-critical test gap |
