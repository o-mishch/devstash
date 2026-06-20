# AI Usage Meter — Specification

## Status
Proposed — not started. Written against `main` + the current AI rate-limit infrastructure. No
Prisma migration; no change to how limits are enforced — this feature only **surfaces** data that
already exists in Redis.

## Goal
Show users (Pro, who are the only ones that can call AI) **how many AI calls they have left per
feature and when that budget renews**, proactively — before they hit a wall — instead of only
discovering the cap via a 429 after the fact.

**Primary surface:** a per-skin **AI Usage widget on the dashboard** (Pro-only) that lives in every
skin's layout and shows the live per-feature remaining budget + "next slot in Xm", built with Magic
UI components (`NumberTicker`, `AnimatedShinyText`, optional `AnimatedCircularProgressBar` /
`BorderBeam`). See §3a. Inline per-affordance hints and a settings list are secondary (§3b).

## Background — where this data lives today

AI usage is **not** a DB-stored credit balance. It is governed entirely by **Upstash Redis
sliding-window rate limits**, keyed per user:

- `src/lib/infra/rate-limit.ts` defines four independent AI buckets — `aiTags`, `aiDescription`,
  `aiExplain`, `aiOptimize` — each `{ attempts: AI_FEATURE_HOURLY_LIMIT, window: '1 h' }`.
- `AI_FEATURE_HOURLY_LIMIT = 20` (`src/lib/utils/constants.ts`). Each feature has its **own** 20/hr
  budget — there is no shared "AI total".
- Bucket key: `${RATE_LIMIT_NS}:<key>` in Redis, identifier = session `userId` (IDOR-safe).
- It is a **rolling** sliding window — the budget continuously regenerates; it does **not** reset on
  a fixed monthly/daily boundary.
- Same limit for everyone past the Pro gate; no higher Pro tier in the config today.

**Currently exposed to the user:** almost nothing.
- `checkRateLimit` computes `remaining`/`reset` but **discards `remaining`**, returning only
  `{ success, retryAfter }` (`rate-limit.ts`).
- The only live signal is the **429 after exhaustion** (`rateLimited()` → `deniedMessage()` +
  `Retry-After`).
- The only proactive hint is **static copy**: `aiRateLimitHint('optimizations')` → "20
  optimizations per hour". It's the fixed cap, never the live remaining count.

## Context7 — Upstash Ratelimit best practice (verified)

`@upstash/ratelimit` exposes a **non-consuming read** that is exactly what a usage display needs:

```ts
ratelimit.getRemaining(identifier: string): Promise<{ remaining: number; reset: number }>
```

- `remaining` — requests left in the current window.
- `reset` — **Unix timestamp in milliseconds** when the window rolls over.

Key point: **`getRemaining()` does not subtract a token** — unlike `limit()`, which both checks and
consumes. A usage meter must use `getRemaining()`, never `limit()`, so that *viewing* the budget
never spends it. (`limit()`'s response also carries `limit`/`remaining`/`reset`, but it is for the
enforcement path only.)

## Design

### 1. Read layer — `src/lib/infra/rate-limit.ts`

Add a non-consuming reader for the AI keys. The limiter instances already exist in `getLimiters()`;
reuse them so window/config stay the single source of truth.

```ts
export const AI_RATE_LIMIT_KEYS = ['aiTags', 'aiDescription', 'aiExplain', 'aiOptimize'] as const
export type AiRateLimitKey = (typeof AI_RATE_LIMIT_KEYS)[number]

export interface AiFeatureUsage {
  key: AiRateLimitKey
  limit: number        // AI_FEATURE_HOURLY_LIMIT (from LIMIT_CONFIG[key].attempts)
  remaining: number
  resetAt: number      // ms epoch, from getRemaining().reset
}

export async function getAiUsage(userId: string): Promise<AiFeatureUsage[]>
```

- Calls `limiter.getRemaining(userId)` for each AI key with `Promise.all` (one round-trip per key;
  four parallel reads). `getRemaining()` returns `{ remaining, reset }` in current
  `@upstash/ratelimit` — `reset` is the ms-epoch window roll-over → `resetAt`.
- **Never reuse `check()` / `limit()` here.** `check()` consumes a token *and* fail-**closed** in
  production (`denyWhenUnavailable`) — both wrong for a read meter. `getAiUsage` is a separate,
  always-**fail-open** reader: on any thrown error or null limiters it returns each feature at full
  budget `{ remaining: limit, resetAt: Date.now() }`, regardless of `NODE_ENV`. Viewing usage must
  never spend a token and must never block or error the dashboard.
- `limit` comes from `LIMIT_CONFIG[key].attempts` (module-local to `rate-limit.ts`, so read it
  in-file — do not re-export the whole config). The cap stays config-driven, not hardcoded.
- Wrap the four-key fan-out in a single `try/catch`; a partial Redis failure degrades the *whole*
  payload to full budget rather than returning a mix of real + zeroed entries (which would render a
  misleading "0 left" on one feature). Log the fallback once via the scoped Pino child
  (`logger.child({ tag: 'ai-usage' })`), per the logging rule.

### 2. Endpoint — `GET /ai/usage`

Per `nextjs-architecture.md` / `api-contract.md`: new endpoint = new `route.ts` + `paths.ts`
declaration + schema, then `npm run openapi:gen`. **Not** a Server Action.

- `src/app/api/ai/usage/route.ts` — `authedRoute({}, ...)`, `userId` from session (never input).
- **Pro gate:** AI is Pro-only, so gate like the other AI routes — return `403` for non-Pro (or
  return an empty/zeroed payload; decide in implementation, but be consistent with sibling AI
  routes which 403).
- Read-only `GET` ⇒ **no `rateLimit` option** on the route (reading usage must not consume a token,
  and the read itself is cheap). Optionally add a light `aiUsage` IP/user bucket only if abuse is a
  concern — default: none.
- Response schema `aiUsageOutput` in `src/lib/api/schemas/ai.ts` (`[C]`, browser-safe Zod), shape:

```ts
// { features: { key, limit, remaining, resetAt }[] }
```

- `paths.ts` entry mirrors the existing `/ai/*` blocks (responses: `200` aiUsageOutput, `401`
  unauthorized, `403` Pro-required). Then `npm run openapi:gen` to regenerate `openapi.json` +
  `src/types/openapi.ts` (do not hand-edit).

### 3. Client data — `useAiUsage()` hook

- Fetch via the typed client only — `$api` (openapi-react-query) from `@/lib/api/client`. Never
  `fetch`/`axios`, never a Server Action. (This is the repo's first `$api` *query* hook; existing AI
  hooks use one-off `api.POST`. `$api.useQuery('get', '/ai/usage')` is the correct primitive.)
- `src/hooks/use-ai-usage.ts` owns the query **and** the invalidation helper (per coding-standards:
  components never call `useQueryClient()` directly). Export both:
  - `useAiUsage()` → `$api.useQuery('get', '/ai/usage', {}, { ...options })`.
  - `useInvalidateAiUsage()` → returns `() => queryClient.invalidateQueries({ queryKey })` for the
    `/ai/usage` key (derive the key via `$api.queryOptions('get', '/ai/usage').queryKey` so it
    always matches `useAiUsage`). This is the single place that touches `queryClient`.

#### Invalidate on EVERY AI-feature trigger (required, lint-enforced)

Every time the user triggers **any** AI feature, the usage query **must** be invalidated so the
meter reflects the spent slot. Rather than rely on each hook remembering to do this (a convention
that gets missed), enforce it with **one mandatory choke point + a lint rule that fails the build**
if anything bypasses it.

**The rule (single sentence):**
> All client `/ai/*` **mutations** go through one wrapper, `runAiMutation` (in
> `src/hooks/use-ai-usage.ts`), which invalidates the `/ai/usage` query `onSettled`. Calling
> `api.POST('/ai/…')` / `$api` against an `/ai/*` mutation path **anywhere else is a lint error.**

**The wrapper — the only sanctioned way to call an AI mutation from the client:**
```ts
// src/hooks/use-ai-usage.ts
export function useAiMutation() {
  const invalidate = useInvalidateAiUsage()          // owns queryClient; see above
  // P = '/ai/optimize' | '/ai/explain' | '/ai/tags' | '/ai/description' | future '/ai/*'
  return async <P extends AiMutationPath>(path: P, body: AiMutationBody<P>) => {
    try {
      return await api.POST(path, { body })          // openapi-fetch: never throws, returns {data,error}
    } finally {
      invalidate()                                   // ⬅ fires on success, error, AND 429 — always
    }
  }
}
```
- `finally` (≈ `onSettled`) is deliberate: the limiter consumes the token **before** the OpenAI call
  (`checkRateLimit` → `limit()` runs first in the route), so a slot is spent even when generation
  fails, and a `429` means the budget is already exhausted. `onSuccess`-only would leave the meter
  stale after failures/429s.
- `invalidate()` is a cheap no-op when the meter isn't mounted (no active observer), so calling it
  unconditionally is safe — no `isPro`/visibility guard needed at the call site.

**Constraints (each one closes a "could be missed" gap):**
1. **One entry point.** `runAiMutation` is the *only* place `api.POST('/ai/…')` for a mutation may
   appear. The four current consumers (`useOptimizePrompt`, `useAiItemRewrite`/Explain, tag
   generator, description generator) call the wrapper instead of `api.POST` directly.
2. **Lint makes it mechanical, not memory.** Add an ESLint `no-restricted-syntax` rule banning AI
   mutation calls outside the wrapper, e.g.:
   ```jsonc
   // eslint config — selector matches api.POST('/ai/…') / $api…('/ai/…') by string-literal arg
   "no-restricted-syntax": ["error", {
     "selector": "CallExpression[callee.property.name='POST'][arguments.0.value=/^\\u002Fai\\u002F/]",
     "message": "Call AI mutations via runAiMutation() (src/hooks/use-ai-usage.ts) so /ai/usage is invalidated."
   }]
   ```
   Allow it **only** inside `src/hooks/use-ai-usage.ts` via an `overrides` entry that turns the rule
   off for that file. Now a new `api.POST('/ai/anything')` written anywhere else **fails `npm run
   lint`** — nothing can be missed.
3. **New endpoints are covered by construction.** Adding `POST /ai/<new>` forces the author through
   `runAiMutation` (lint), so it inherits invalidation automatically. Add `'/ai/<new>'` to the
   `AiMutationPath` union — the only manual step, and a type error until done.
4. **Reads are exempt and unaffected.** `/ai/usage` is a `GET`; the selector targets `.POST` with an
   `/ai/` path, so the meter's own read never matches. Do not route the read through the wrapper.
5. **Invalidation is primary, polling is the fallback.** The 60s `refetchInterval` only covers the
   passive window slide; user-triggered spends rely on the wrapper's `invalidate()` — it must never
   be dropped on the assumption the poll will catch up.

**Checklist mirror (AI-route rule):** *every `POST /ai/*` route needs (a) a `LIMIT_CONFIG` rate-limit
key and (b) a client call via `runAiMutation`.* Put this next to the rate-limit entry in
`api-contract.md` so the two always land together.
- **Query options (Context7-verified, TanStack Query polling guide):** the rolling window
  regenerates continuously, so treat usage as live-ish but cheap:
  - `refetchInterval: 60_000` — re-read once a minute while the dashboard is open (the budget drifts
    slowly; a faster poll wastes Redis reads).
  - `refetchOnWindowFocus: true` — refresh when the user returns to the tab.
  - `staleTime: 30_000` — coalesce remounts/navigation within the window.
  - `refetchIntervalInBackground: false` — pause polling on hidden tabs (default; matches the
    "ambient animations pause off-screen" guardrail).
  - `enabled: isPro` — never fire for free users (defense in depth on top of the route 403 and the
    server-side mount gate below).
- The live **"renews in Xm"** countdown is derived client-side from `resetAt - Date.now()`; it does
  **not** require polling. Add a small `formatRenewIn(resetAt: number): string` to
  `src/lib/utils/format.ts` (`[C]`, browser-safe — there is no relative-time helper today) returning
  e.g. `"next slot in 4m"` / `"renews as you go"`. Recompute it with a lightweight 30s `useNow()`
  tick inside the widget so the label ticks down between refetches without extra network calls.
  Phrase for a **rolling** window ("next slot in Xm" / "frees up in Xm"), never "resets at midnight".

### 3a. Front-end — dashboard AI-usage widget (per skin) ⭐ primary surface

**Goal:** every dashboard skin renders a compact **AI Usage** widget for Pro users, showing the live
remaining budget per AI feature and when the next slot frees up — proactive, on the page they land
on, before they ever hit a 429.

**Component:** one shared `src/components/dashboard/ai-usage-widget.tsx` — a `'use client'` island
(it polls + animates, so it cannot live in the server `shared.tsx`). It calls `useAiUsage()` itself;
**no AI-usage promise is threaded through `DashboardSkinData`** — the rolling Redis read is not a
`'use cache'` DB helper and must stay live (poll + invalidate), so coupling it to the server-fetched
skin promises would be wrong. Each skin renders the island directly.

**Props:**
```ts
interface AiUsageWidgetProps {
  skin: UiSkin           // drives the visual treatment (token vs. bold-Pro chrome)
  className?: string     // skin controls placement in its grid/bento
}
```

**Server-side Pro gate (authoritative):** skins receive `isPro` already (`DashboardSkinData.isPro`).
Render `{isPro && <AiUsageWidget skin={skin} />}` — free users never mount it (and they cannot reach
a Pro skin anyway; `resolveAccessibleSkin` already floors them to `classic`). The widget is therefore
only ever seen by Pro users; the route 403 + `enabled: isPro` are the redundant client guards. Since
the dashboard already gates on `isPro` server-side, there is **no upsell variant** in scope here —
free users simply don't see an AI widget (AI is Pro-only).

**No-flash note:** unlike the skin *layout* (resolved server-side), this secondary widget self-fetches
on the client and shows a `Skeleton` (existing `src/components/ui/skeleton.tsx`) on first paint. That
is acceptable — it does not shift the page layout (fixed-size card slot per skin), and the live/rolling
nature of the data makes a client read the correct trade-off. The page shell and skin layout still
prerender with zero flash.

**Widget content (all four features, per the resolved product decision below):**
- Header: `✦ AI Usage` label via **`AnimatedShinyText`** (matches the existing "✦ Optimize" Pro/AI
  affordance treatment), with a `motion-safe` shimmer.
- One row per feature (`Optimize`, `Explain`, `Tags`, `Description`) using the system item-type /
  AI iconography (`lucide-react`, repo norm) showing:
  - **`<remaining> / <limit>`** with the number animated by **`NumberTicker`** (counts to the live
    remaining on refetch).
  - a slim progress indicator for `remaining/limit` — keep the **trivial bar custom** (`Progress` /
    plain divs, per current-feature's "no library earns its place" rule), OR for the bold/Pro skins
    use **`AnimatedCircularProgressBar`** (a ring per feature) where the skin's identity calls for it.
  - the derived **"next slot in Xm"** sublabel (`formatRenewIn`) when `remaining < limit`; show a calm
    "Full — 20 left" state at full budget.
- Empty/exhausted state: when `remaining === 0`, surface the renew time prominently (proactive — the
  whole point of the feature) instead of waiting for the 429 toast.

**Per-skin visual treatment (token-first, bold chrome gated to Pro skins, all `motion-safe`):**

| Skin | Widget treatment |
|------|------------------|
| `classic`, `aurora`, `editorial` (free skins) | Plain token-styled `Card` + custom bars + `NumberTicker`. **No** heavy Magic UI chrome (keep the free path light, per the guardrails). |
| `spatial` | Frosted-glass card (Tailwind `backdrop-filter`) matching the skin; bars. |
| `command-deck` | HUD/segmented readout — reuse `TypeDistributionSegments` styling language; mono numerals. |
| `mission-control` | `AnimatedCircularProgressBar` rings per feature (fits the analytics-cockpit identity, sits beside the donut/heatmap). |
| `orbital` | Four small rings or budget pips around the existing core motif. |
| `neon-grid`, `holographic` | `BorderBeam` accent on the card edge (already vendored); neon/iridescent tokens. |

Reuse `SkinSectionHeader` from `skins/shared.tsx` so the widget header matches each skin's section
chrome. Drive the per-skin branch off the `skin` prop (a small `switch`/lookup), not nested ternaries
(coding-standards).

**Magic UI components to add** (not yet vendored — only `border-beam`, `animated-grid-pattern`,
`dot-pattern`, `orbiting-circles`, `retro-grid` exist today). Add via the shadcn registry
(Context7-verified slugs; lands as vendored source, **no new runtime dep** — uses `motion/react`
already installed):
```bash
npx shadcn@latest add @magicui/number-ticker
npx shadcn@latest add @magicui/animated-shiny-text
npx shadcn@latest add @magicui/animated-circular-progress-bar   # only if bold-skin rings are built
```
- `AnimatedShinyText` ships a `shiny-text` keyframe that must be registered in `globals.css` under
  Tailwind v4 (`@theme inline { --animate-shiny-text: shiny-text 8s infinite; @keyframes shiny-text {…} }`
  — exact block from Context7). Verify it isn't already covered by the imported `tw-animate-css`.
- Vendored Magic UI files use `window`/`document` and trip the `coding-standards` lint rule — keep
  them under `src/components/ui/`, treat as third-party, `eslint-disable` per file; do not refactor
  (same handling as the five already vendored).
- Gate all animated chrome to `motion-safe:` + the bold/Pro skins so the free `classic`/`aurora`
  path stays light and honors `prefers-reduced-motion`.

### 3b. Secondary surfaces (optional, after the widget ships)
- A compact "N / 20 left" hint next to each inline AI affordance (Explain / Optimize buttons, tag
  generation), driven by that feature's entry from the same `useAiUsage()` hook.
- A small AI-usage section in `/settings` listing all four features.
These reuse the hook and `formatRenewIn` — no new data path. Ship the dashboard widget (3a) first.

### 4. Keep enforcement unchanged

The actual gating in the AI POST routes stays exactly as-is (`runProAiGeneration` → `checkRateLimit`
→ `limit()` consumes). This feature is **read-only observability layered on top**. Do not move
enforcement to the new reader.

### 5. Performance — Redis round-trips & caching (Context7-verified)

Two questions were raised: *(a) can we read all four buckets in one Redis call?* and *(b) can we
cache the result and skip Redis until it's mutated?* Answers below, with the verified facts.

**Cost of the read — verified against the installed source (`@upstash/ratelimit` v2.0.8,
single-region sliding window).** The published "cost table" (`EVAL, GET, GET = 3`) describes the
multi-region / older path and does **not** apply here. In `dist/index.mjs`, single-region
`slidingWindow.getRemaining` does exactly **one** awaited Redis command — a single `EVALSHA`
(reusing the `fixedWindow.getRemaining` Lua script; it reads only the current bucket and returns
`{ remaining, reset, limit }`). So **four features = 4 `EVALSHA`**, and because each has a single
`await` with no internal sequential commands, all four enqueue in the same tick ⇒ auto-pipelining
flushes them as **one `/pipeline` HTTP request → genuinely one network call.**

> **Is it *really* one call?** Yes — and not by luck. The doubt is valid for limiters whose
> `getRemaining` issues several commands across internal `await`s (those would split across ticks
> into multiple pipeline flushes). But the source shows single-region sliding window issues exactly
> **one** command per call (`await safeEval(...)`), so the four batch cleanly. **One exception:**
> `safeEval` runs `EVALSHA` and, only on a `NOSCRIPT` error (script not yet cached on the Redis
> server — happens at most once after a script eviction), retries with `EVAL` in a later tick. That
> cold path costs **2** round-trips once; every subsequent read is **1**.

#### (a) One network call — REQUIRED: auto-pipelining + same-tick fan-out

The four `getRemaining()` reads collapse to a **single HTTP request**. Two pieces are needed
together — both are required, not optional:

1. **Enable auto-pipelining on the shared Upstash client.** This is the SDK's batching switch; with
   it on, commands issued in the same event-loop tick are bundled into one `/pipeline` request.
   ```ts
   // src/lib/infra/redis.ts
   _client = Redis.fromEnv({
     signal: () => AbortSignal.timeout(5000),
     cache: 'no-store',
     enableAutoPipelining: true,   // ⬅ batch same-tick commands into ONE HTTP request
   })
   ```
2. **Fire all four `getRemaining()` synchronously, then a single `await Promise.all`** — no `await`
   *between* the calls, or they land in separate ticks and separate HTTP requests. All four limiters
   come from the **same** `getRedis()` instance (see `getLimiters()`), which is what lets the SDK
   merge their commands into one batch.
   ```ts
   // src/lib/infra/rate-limit.ts — getAiUsage()
   const l = getLimiters()
   if (!l) return AI_RATE_LIMIT_KEYS.map(fullBudget)   // fail-open, no Redis
   try {
     // issue all four in the SAME tick — auto-pipelining batches them into one request
     const reads = AI_RATE_LIMIT_KEYS.map((key) => l[key].getRemaining(userId))
     const results = await Promise.all(reads)           // ⬅ single /pipeline round-trip
     return AI_RATE_LIMIT_KEYS.map((key, i) => ({
       key,
       limit: LIMIT_CONFIG[key].attempts,
       remaining: results[i].remaining,
       resetAt: results[i].reset,
     }))
   } catch {
     return AI_RATE_LIMIT_KEYS.map(fullBudget)          // fail-open on any error
   }
   ```
   Per Upstash docs: *"Commands are added to an internal pipeline and executed together when `await`
   is called on a `Promise.all`."* Result: **4 `EVALSHA`, 1 network round-trip** (steady state).

- **Don't hand-roll an `MGET`.** `getRemaining` runs a Lua script (`EVALSHA`) that computes
  remaining from the window bucket; a manual `MGET` re-implements that, couples to
  `@upstash/ratelimit`'s internal key layout, and desyncs from the enforcement path. Auto-pipelining
  already gives the single call — there is no reason to bypass the library.
- **Cost vs. latency:** Upstash bills the 4 `EVALSHA` commands (pipelining batches transport, not
  billing) — the win is the **single round-trip** (4 sequential HTTP calls → 1) and fewer sockets.
- **Scope caveat — it's a global client flag.** Auto-pipelining batches *any* same-tick commands
  across the whole app (auth, item mutations, etc.). It is additive and Upstash-recommended, but it
  shifts command execution to a microtask boundary, so **verify the enforcement limiters still behave
  identically** (each issues one `limit()` per request — unaffected) by running the rate-limit tests.
  Land the flag with that test pass.

#### (b) No server-side cache (decided)

**Skip the server cache.** The client **TanStack Query** layer in `useAiUsage()` is the only cache:
`staleTime: 30_000` serves repeat reads from memory, `useInvalidateAiUsage()` forces an immediate
refetch on AI-mutation success, and `refetchInterval` absorbs the rolling-window slide. A server
`'use cache'` would be *caching a cache* — Redis is already the fast KV store, now a single
round-trip via (a) — and the sliding window has **no invalidation event** for its passive slide, so
it would need a short TTL that claws back most of the savings. Not worth the complexity for a
low-stakes meter (KISS / coding-standards). `getAiUsage` reads Redis directly on each cache miss;
the client query cache and the one-round-trip read keep that cheap.

## Files to touch

- `src/lib/infra/rate-limit.ts` — add `AI_RATE_LIMIT_KEYS`, `AiFeatureUsage`, `getAiUsage()`
  (always fail-open `Promise.all` of `getRemaining`). `[S]`
- `src/lib/infra/redis.ts` — add `enableAutoPipelining: true` to the shared client so the four
  `getRemaining` reads collapse to one HTTP round-trip (§5a). Land + test separately (global flag).
- `src/lib/api/schemas/ai.ts` — add `aiUsageOutput` Zod schema. `[C]`
- `src/lib/api/openapi/paths.ts` — add `'/ai/usage'` GET declaration.
- `src/app/api/ai/usage/route.ts` — new `authedRoute` handler (Pro gate + `getAiUsage`).
- `openapi.json` + `src/types/openapi.ts` — regenerated via `npm run openapi:gen` (do not hand-edit).
- `src/hooks/use-ai-usage.ts` — `$api`-backed `useAiUsage()` query (poll/staleTime/`enabled: isPro`)
  + `useInvalidateAiUsage()` helper. `[C]`
- `src/lib/utils/format.ts` — add `formatRenewIn(resetAt: number): string` (rolling-window phrasing).
  Cover in `src/lib/utils/format.test.ts`. `[C]`
- `src/components/dashboard/ai-usage-widget.tsx` — **new** `'use client'` per-skin widget (primary
  surface): `useAiUsage()` + `NumberTicker` / `AnimatedShinyText` / bars (or `AnimatedCircularProgressBar`
  on bold skins) + `formatRenewIn`, branched on the `skin` prop.
- `src/components/dashboard/skins/*.tsx` — each skin renders `{isPro && <AiUsageWidget skin={skin} />}`
  in its layout (the skins already receive `isPro` via `DashboardSkinData`). No change to
  `DashboardSkinData` / `dashboard/page.tsx` data fetching — the widget self-fetches client-side.
- `src/components/ui/number-ticker.tsx`, `animated-shiny-text.tsx` (+ `animated-circular-progress-bar.tsx`
  if bold rings are built) — vendored via `npx shadcn@latest add @magicui/<slug>` (do not hand-author).
- `src/app/globals.css` — add the `shiny-text` keyframe under `@theme inline` (Tailwind v4) if not
  already provided by `tw-animate-css`.
- `src/hooks/use-ai-usage.ts` — also exports `runAiMutation`/`useAiMutation` (the single AI-mutation
  wrapper) + the `AiMutationPath` union. Every `/ai/*` mutation goes through it; it invalidates
  `/ai/usage` in `finally` (success/error/429). `[C]`
- The four AI consumers (`use-optimize-prompt.ts`, `use-ai-item-rewrite.ts` Explain, tag + description
  generators) — call `runAiMutation` instead of `api.POST('/ai/…')` directly.
- ESLint config (`eslint.config.*`) — add the `no-restricted-syntax` rule banning
  `api.POST('/ai/…')` outside `use-ai-usage.ts` (allow it there via an `overrides` entry). Makes the
  invalidation impossible to miss — a stray AI call fails `npm run lint` (§3, lint-enforced rule).
- `.agents/rules/api-contract.md` — add the AI-route checklist line: every `POST /ai/*` needs a
  `LIMIT_CONFIG` key **and** a client call via `runAiMutation`.

## Tests (per testing rule — server util + schema covered)

- `src/lib/infra/rate-limit.test.ts` — `getAiUsage` returns one entry per AI key with
  `limit === AI_FEATURE_HOURLY_LIMIT`; fail-open path returns full budget when limiters are null.
- `src/app/api/ai/usage/route.ts` coverage if route-level tests apply (401 unauth, 403 non-Pro,
  200 shape) — mirror `src/app/api/ai/ai.test.ts`.
- `src/lib/utils/format.test.ts` — `formatRenewIn` boundaries: full budget → "renews as you go",
  `< 60s` → "next slot in <1m", minutes rounding, past/zero `resetAt` → no negative time.
- No component tests (repo rule — the widget, hook, and Magic UI vendored files are not unit-tested).

## Product decisions

1. **Per-feature display — RESOLVED: show all four.** The model is per-feature (4 × 20/hr); the
   dashboard widget lists `Optimize / Explain / Tags / Description` so it matches reality and never
   implies a shared pool. (A collapsed one-line headline is rejected — it would misrepresent four
   independent buckets.)
2. **Window framing — rolling hourly, not a monthly allowance.** "Calls left + when they renew" maps
   to `remaining` + `resetAt`; the UI says "next slot in Xm", never "resets at midnight". If product
   later wants a *monthly* Pro quota with a single renewal date, that is a **different storage model**
   (DB-backed counter + reset job) and a separate spec — flag it, don't fake it on the rolling window.
3. **Non-Pro behavior — RESOLVED: 403 + no widget.** The route 403s like sibling AI routes, and the
   dashboard simply doesn't mount the widget for free users (AI is Pro-only; they can't reach a Pro
   skin either). No zeroed-payload upsell meter on the dashboard in this scope — the existing
   upgrade-prompt affordances already cover the AI-is-Pro story elsewhere.

## Out of scope
- Changing the limit value, making limits Pro-tiered, or moving to a monthly quota model.
- Any DB schema / Prisma migration.
- Real-time push of usage (poll/invalidate on mutation is sufficient).
- Surfacing non-AI rate limits (auth, item, upload) in the UI.
