# Improve — Evaluation Checklist

Apply **P1 → P5** across the whole changeset (holistic, not per-file). **KISS = decrease LOC** — always scan P2 for −LOC wins. Zero findings → `No issues found.`

**Finding shape:** `[ID]` · **Major|Minor** · `path(s)` — Title · Issue · Evidence · Recommendation · Rule (P4/P5 only)

---

## P1 — Architecture & SOLID

*Lens: right layer? redesign removes debt?*

| Signal | Look for |
| --- | --- |
| FE/BE leak | `'use client'` imports `lib/db`, prisma, Stripe SDK, server env |
| UI owns rules | billing/access/validation logic in components |
| BE in UI | DB/Stripe calls in components or thin routes |
| Data layer | `prisma.*` outside `src/lib/db/` (except `auth.ts` adapter) |
| Boundaries | fat actions; logic that belongs in `src/lib/` |
| Placement | wrong directory per coding-standards |
| Coupling | circular imports; unrelated modules tightly coupled |
| Redesign | flow spread across too many files; patches leave structural debt |

Major redesign → include: current shape → proposed shape → benefit

---

## P2 — KISS & duplication

**KISS = decrease LOC.** The simplest correct solution has the fewest lines, files, and layers. Every improve run must hunt for −LOC wins — not only flag creep.

*Lens: delete/merge/inline before adding. Single source of truth. Net `src/` LOC ↓ is the primary KISS signal.*

| Signal | Look for |
| --- | --- |
| Over-decompose | one-liner wrapper; single-export single-use file; deep import chain |
| Over-engineer | one-impl abstraction; unused generic; premature cache/state machine |
| Duplicate | same rule in 2+ files (Pro access, subscription status, billing display) |
| LOC creep | changeset or prior fixes grew `src/` without removing equivalent code — **always P2** |
| −LOC opportunity | duplicate, dead file, wrapper, over-split module, client→server — **report even if Minor** |
| Additive fix | recommendation only adds lines — **required:** leaner −LOC variant |
| Growth without payoff | net +LOC for logging/tests/helpers that could be inline or merged |

Every P2 finding: **est. LOC Δ** (show **−N** prominently for cuts). Default fix: merge/delete/inline. Adding lines needs explicit why no −LOC path exists. Surface top −LOC items in report **KISS — decrease LOC** section.

---

## P3 — Security & access outage

*Lens: leak, auth bypass, wrong deny/grant at scale? (high-level only)*

| Signal | Look for |
| --- | --- |
| Auth | missing session check in action/API/webhook |
| IDOR | `userId` from input not session |
| Input | external data without Zod |
| Tokens | weak/reusable token; missing expiry |
| Rate limit | new auth-adjacent endpoint unprotected |
| Webhook | no signature verify or idempotency |
| Exposure | secrets, stack traces, internal errors to client |
| Access | stale Pro/billing cache after write; sync/webhook race |
| Outage | Stripe/DB error in layout blocks app; checkout↔webhook↔sync race |

Major → row in Security & access risks table (`Fix now`).

---

## P4 — Bugs, regressions & logging

*Bugs lens: production break or behavior regression?*

| Signal | Look for |
| --- | --- |
| Logic | wrong branch; null/empty edge; partial write no rollback |
| Race | checkout↔webhook↔sync; stale cache after write |
| Contract | changed API breaks caller in changeset |
| Access | wrong Pro grant/deny; subscription transition gap |
| Async | missing `await`; floating promise |
| Hydration | client/server boundary bug |
| Tests | weakened/removed assertions |
| Regression | Prior fix or accepted tradeoff broken in code (cite audit ID + run #) |
| Dropped audit ID | any audit-table ID missing from report **Audit reconcile** — **process failure** |
| Dead end | checkout/portal/upgrade with no recovery |

Major bug → row in Bugs & regressions table (`Fix now`).

*Logging — coding-standards § Logging; `createLogger('tag')` only, no wrappers*

| Signal | Look for |
| --- | --- |
| Missing | critical state change / API call / webhook not logged |
| Swallowed | error on billing/auth/webhook path without `log.error` |
| Shape | no headline → context (IDs) → description when useful |
| Noise | excessive low-signal logs; wrong level |
| Wrapper | custom logger around `createLogger` |

---

## P5 — Convention, hygiene & tests

*Cite `coding-standards` § section. Also `api-contract.md` when actions/API in scope.*

| Area | Look for |
| --- | --- |
| TypeScript | inline types; `Foo & {}` on params; `any`; `@ts-ignore`; `const enum` |
| React | class component; inline props; nested ternary; `React.` prefix |
| Next.js | see **SSR** below |
| API | see **API surface** below |
| Styling | `tailwind.config.*`; inline styles; redundant `cursor-pointer` on buttons |
| Quality | commented-out code; unused imports; fn >50 lines; forbidden env vars |
| Hygiene | ESLint; `console.log`; stale TODO; env.d.ts / `.env.example` drift |
| Tests | changed `lib/` or `actions/` without meaningful test; weak mocks; missing edge cases |

### API surface — `api.ts` / `api-response.ts` / `api-fetch.ts`

*Lens: `api-contract.md`. JSON and redirects go through project helpers unless strictly justified.*

| Signal | Look for |
| --- | --- |
| Raw JSON response | `NextResponse.json()` in `src/app/api/` — use `ApiResponse` + `apiRoute` |
| Raw redirect | `NextResponse.redirect()` in API routes — use `apiRedirect` + `apiRoute` |
| Unwrapped route | handler exported without `apiRoute` / `authenticatedRoute` |
| Client fetch | `fetch()` / `axios` in client components — use `apiFetch` or Server Action |
| Action shape | Server Action returns bool/string instead of `ApiBody<T>` |
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
| `'use client'` import leak | client file imports server-only module (also P1 FE/BE leak — **Major**) |

**Minor** — can convert to server component or Server Action with est. LOC −.  
**Major** — client boundary hides server-only imports or blocks critical server fetch path.

When components are in scope: include **SSR** detail table in report (file · current · can convert? · est. LOC).

---

## Severity

| Major | Minor |
| --- | --- |
| Bug; audit regression; FE/BE leak; security/access outage; API violation (`apiRoute`/`ApiResponse`/`apiRedirect`/`apiFetch`); swallowed critical error; weak critical-path tests; redesign strongly warranted | KISS tweak; convention; hygiene; raw `NextResponse.redirect` without justification; unnecessary `'use client'` / client fetch (SSR); non-critical test gap |

**Finding ID:** `P{n}-{seq}` — stable across runs.
