# AI Usage Meter — Specification

## Status
Proposed — not started. Written against `main` + the current AI rate-limit infrastructure. No
Prisma migration; no change to how limits are enforced — this feature only **surfaces** data that
already exists in Redis.

## Goal
Show users (Pro, who are the only ones that can call AI) **how many AI calls they have left per
feature and when that budget renews**, proactively — before they hit a wall — instead of only
discovering the cap via a 429 after the fact.

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

- Calls `limiter.getRemaining(userId)` for each AI key (in parallel).
- **Fail-open / unavailable:** mirror `check()` — if Redis/limiters are unavailable, return each
  feature as `{ remaining: limit, resetAt: Date.now() }` (full budget) so the UI degrades to "full"
  rather than erroring or showing "0 left". Never block the page on a usage read.
- `limit` comes from `LIMIT_CONFIG[key].attempts`, so the cap is read from config, not hardcoded.

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

### 3. Client + UI

- Fetch via the typed client only — `$api` (openapi-react-query) from `@/lib/api/client`. Never
  `fetch`/`axios`, never a Server Action.
- A `useAiUsage()` hook wrapping the `$api` query for `/ai/usage`; owns its cache key. After a
  successful AI mutation (optimize/explain/tags/description) **invalidate** the usage query so the
  meter refreshes (cache-updater logic lives in the hook file, per coding-standards — components
  don't touch `queryClient`).
- **Display surfaces (proposal — confirm with product):**
  - A compact "N / 20 left this hour" indicator next to each AI affordance (Explain / Optimize
    buttons, tag generation), driven by that feature's entry.
  - "Renews in ~Xm" derived from `resetAt - now` (format with the existing time helpers; it's a
    rolling window so phrase it as "renews as you go / next slot in Xm", not "resets at midnight").
  - Optional: a small AI-usage section in `/settings` listing all four features.
- Reduced/empty states: when `remaining === 0`, the affordance can show the renew time proactively
  instead of waiting for the 429 toast.

### 4. Keep enforcement unchanged

The actual gating in the AI POST routes stays exactly as-is (`runProAiGeneration` → `checkRateLimit`
→ `limit()` consumes). This feature is **read-only observability layered on top**. Do not move
enforcement to the new reader.

## Files to touch

- `src/lib/infra/rate-limit.ts` — add `AI_RATE_LIMIT_KEYS`, `AiFeatureUsage`, `getAiUsage()`
  (uses `getRemaining`). `[S]`
- `src/lib/api/schemas/ai.ts` — add `aiUsageOutput` Zod schema. `[C]`
- `src/lib/api/openapi/paths.ts` — add `'/ai/usage'` GET declaration.
- `src/app/api/ai/usage/route.ts` — new `authedRoute` handler (Pro gate + `getAiUsage`).
- `openapi.json` + `src/types/openapi.ts` — regenerated via `npm run openapi:gen` (do not hand-edit).
- `src/hooks/use-ai-usage.ts` — `$api`-backed hook + invalidation helper.
- AI affordance components (e.g. Explain/Optimize controls, settings) — render the meter.

## Tests (per testing rule — server util + schema covered)

- `src/lib/infra/rate-limit.test.ts` — `getAiUsage` returns one entry per AI key with
  `limit === AI_FEATURE_HOURLY_LIMIT`; fail-open path returns full budget when limiters are null.
- `src/app/api/ai/usage/route.ts` coverage if route-level tests apply (401 unauth, 403 non-Pro,
  200 shape) — mirror `src/app/api/ai/ai.test.ts`.
- No component tests (repo rule).

## Open product decisions (ask before building UI)

1. **Per-feature vs aggregate display** — the model is per-feature (4 × 20/hr). Show four meters, or
   collapse to one headline? Recommend per-feature (matches reality; avoids implying a shared pool).
2. **Window framing** — it's a **rolling hourly** window, not a monthly Pro allowance. "Calls left
   + when they renew" maps to `remaining` + `resetAt`. If product wants a *monthly* Pro quota with a
   single renewal date, that is a **different storage model** (DB-backed counter + reset job) and a
   separate spec — flag explicitly, don't fake it on top of the rolling window.
3. **Non-Pro behavior** — 403 (consistent with sibling AI routes) vs. returning a zeroed payload to
   render an upsell meter. Recommend 403 + the existing upgrade-prompt affordance.

## Out of scope
- Changing the limit value, making limits Pro-tiered, or moving to a monthly quota model.
- Any DB schema / Prisma migration.
- Real-time push of usage (poll/invalidate on mutation is sufficient).
- Surfacing non-AI rate limits (auth, item, upload) in the UI.
