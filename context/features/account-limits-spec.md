# Account Limits & Usage — Feature Spec

> **Status:** Spec only (not implemented). Captures the design for a REST endpoint that exposes every
> user-facing limit/quota and a Profile-page widget that renders them.
>
> **Scope decision (confirmed):** surface **everything, including operational rate limits** — quotas,
> static caps, *and* the per-hour rate limits a power user could hit.

---

## 1. Goal

Give the user one authoritative place to see **what they can do and how much headroom is left**:

- **Consumable quotas** — items and collections used vs. their plan cap (the only counts that fill up).
- **Static caps** — upload size limits, field-length limits, tag limits, allowed file types.
- **Operational rate limits** — item mutations / hr, upload presigns / hr, Brain Dump / hr (with live
  remaining where cheap to read).

Two deliverables:

1. A read-only REST route `GET /account/limits` that returns the full, typed limits payload.
2. A `AccountLimitsWidget` rendered on the **Profile** page (`/profile`), built as a client widget on top
   of that route via `$api` — mirroring the existing **AI Usage** widget + `/ai/usage` route pattern.

This is **observability, never enforcement** (same posture as `/ai/usage`): the route never consumes a
token/attempt, always fails open, and never blocks the UI.

---

## 2. The complete limit inventory (source of truth)

Every value below already exists in the codebase — the route is an aggregation layer, **not** a new set
of limits. Grouped by how it's surfaced.

### 2a. Tier quotas (Free vs Pro) — consumable

| Limit | Free | Pro | Source |
|---|---|---|---|
| Total items | **50** | unlimited (`null`) | `FREE_TIER_ITEM_LIMIT` — [constants.ts:3](../../src/lib/utils/constants.ts) |
| Total collections | **3** | unlimited (`null`) | `FREE_TIER_COLLECTION_LIMIT` — [constants.ts:4](../../src/lib/utils/constants.ts) |
| File & Image item types | ✗ (Pro-only) | ✓ | `PRO_ITEM_TYPE_NAMES` — [constants.ts:80](../../src/lib/utils/constants.ts) |

Live **used** counts come from `getProfileData`'s `_count` (`stats.totalItems`, `stats.totalCollections`)
— [src/lib/db/profile.ts](../../src/lib/db/profile.ts). There is **no byte-based storage quota**; only
count caps + per-file size caps.

### 2b. Upload size & type caps (static, Pro feature)

| Limit | Value | Source |
|---|---|---|
| Image upload max | **5 MB** | `IMAGE_MAX_BYTES` — [constants.ts:136](../../src/lib/utils/constants.ts) |
| File upload max | **10 MB** | `FILE_MAX_BYTES` — [constants.ts:141](../../src/lib/utils/constants.ts) |
| Allowed image exts | png, jpg, jpeg, gif, webp, svg | `ALLOWED_IMAGE_EXTS` — [constants.ts:129](../../src/lib/utils/constants.ts) |
| Allowed file exts | pdf, txt, md, json, yaml, yml, xml, csv, toml, ini | `ALLOWED_FILE_EXTS` — [constants.ts:130](../../src/lib/utils/constants.ts) |

### 2c. Field-length caps (static)

| Field | Limit | Source |
|---|---|---|
| Collection name | **100** | `COLLECTION_NAME_MAX_CHARS` — [constants.ts:8](../../src/lib/utils/constants.ts) |
| Collection description | **500** | `collectionFormSchema` — `src/lib/utils/validators.ts` |
| Item description | **2000** | `ITEM_DESCRIPTION_MAX_CHARS` — [constants.ts:59](../../src/lib/utils/constants.ts) |
| Display name | **64** | `NameSchema` — `src/lib/utils/validators.ts` |
| Password | **8–128** | `MAX_PASSWORD_LENGTH` — `src/lib/utils/validators.ts` |

### 2d. Tag caps (static)

| Limit | Value | Source |
|---|---|---|
| Tags per item | **5** | `src/lib/ai/tag-response.ts` / `src/lib/api/schemas/ai.ts` |
| Tag length | **50** | `tagSchema` — `src/lib/ai/tag-response.ts` |

### 2e. Operational rate limits (per `LIMIT_CONFIG` in [rate-limit.ts](../../src/lib/infra/rate-limit.ts))

User-facing buckets worth surfacing (keyed by `userId`, so "remaining" is readable per user):

| Operation | Limit | Window | Key | Live remaining? |
|---|---|---|---|---|
| Item create/update/delete | **120** | 1 h | `itemMutation` | yes (cheap `getRemaining`) |
| Upload presign | **30** | 1 h | `uploadUrl` | yes |
| Brain Dump (AI split) | **1** | 1 h | `aiSplitFile` | yes (already read by `getSplitFileUsage`) |

> **Excluded from the widget** (defensive internals, IP- or auth-keyed, not meaningful to a logged-in
> user browsing their profile): `login*`, `register`, `forgotPassword`, `resetPassword`,
> `resendVerification*`, `linkAccount`, `changePassword`, `changeCredentials`, `credentialEmail`,
> `confirmLoginEmail`, `deleteAccount`, `stripe*`, `updateSettings`. The four `ai*` per-feature buckets
> stay in the existing **AI Usage** widget (`/ai/usage`) and are **not** duplicated here.

---

## 3. REST route — `GET /account/limits`

### Pattern
Mirror [`/ai/usage`](../../src/app/api/ai/usage/route.ts) exactly:

- `authedRoute({}, …)` — **no `rateLimit` option** (reading limits must never consume an attempt).
- `userId` from session (IDOR-safe), `isPro` from the auth context.
- Reads fail **open**: rate-limit "remaining" uses the non-consuming `getRemaining` and degrades to full
  budget on any error, exactly like `getAiUsage` / `getSplitFileUsage`.
- **Not** Pro-gated with a 403 (unlike `/ai/usage`): every user has quotas/caps to see. The payload's
  `plan` field tells the widget whether to show "unlimited" vs a Free cap.

### File: `src/app/api/account/limits/route.ts`
```ts
import { authedRoute } from '@/lib/api/route'
import { json } from '@/lib/api/http'
import { getAccountLimits } from '@/lib/db/account-limits' // new helper (counts + config + remaining)

export const GET = authedRoute({}, async ({ userId, isPro }) => {
  return json(await getAccountLimits(userId, isPro))
})
```

Next.js 16 note (context7-confirmed): route handlers are **not cached by default** and an authed route is
inherently dynamic — so **no** `export const dynamic`/`no-store` is needed, matching `/ai/usage`.

### New server helper: `src/lib/db/account-limits.ts` (`'server-only'`)
Aggregates three sources in one call:
1. **Counts** — `prisma.user.findUnique … _count: { items, collections }` (same shape `getProfileData`
   already selects; reuse or extract a tiny shared count query — do **not** duplicate the whole profile
   read).
2. **Static config** — read straight from `constants.ts` (`FREE_TIER_*`, `FILE_MAX_BYTES`,
   `IMAGE_MAX_BYTES`, `COLLECTION_NAME_MAX_CHARS`, `ITEM_DESCRIPTION_MAX_CHARS`, tag caps, allowed exts).
3. **Rate-limit remaining** — add `getOperationalUsage(userId)` to `rate-limit.ts` alongside
   `getAiUsage`/`getSplitFileUsage`: non-consuming `getRemaining` for `itemMutation`, `uploadUrl`,
   `aiSplitFile`, fired together for auto-pipelining, **fail-open** to full budget. Reuse the existing
   `SplitFileUsage`/`AiFeatureUsage` `{ key, limit, remaining, resetAt }` shape.

### Schema: `src/lib/api/schemas/account.ts` (new `[C]` module)
Bare Zod, browser-safe, `.meta({ id: 'AccountLimits' })`. Proposed shape:
```ts
const quotaSchema = z.object({
  used: z.number(),
  limit: z.number().nullable(),   // null = unlimited (Pro)
})
const rateLimitSchema = z.object({ // mirrors AiFeatureUsage
  key: z.string(),
  limit: z.number(),
  remaining: z.number(),
  resetAt: z.number(),            // epoch ms; 0 = full budget / fail-open
})
export const accountLimitsOutput = z.object({
  plan: z.enum(['free', 'pro']),
  quotas: z.object({
    items: quotaSchema,
    collections: quotaSchema,
  }),
  uploads: z.object({
    fileMaxBytes: z.number(),
    imageMaxBytes: z.number(),
    allowedFileExts: z.array(z.string()),
    allowedImageExts: z.array(z.string()),
    proOnly: z.boolean(),
  }),
  fields: z.object({
    collectionNameMax: z.number(),
    collectionDescriptionMax: z.number(),
    itemDescriptionMax: z.number(),
    displayNameMax: z.number(),
  }),
  tags: z.object({ perItemMax: z.number(), lengthMax: z.number() }),
  rateLimits: z.array(rateLimitSchema), // itemMutation, uploadUrl, aiSplitFile
}).meta({ id: 'AccountLimits' })
```

### OpenAPI: `src/lib/api/openapi/paths.ts`
Add a `'/account/limits'` GET declaration referencing `accountLimitsOutput` (200) + `unauthorized` (401),
then run `npm run openapi:gen` (no hand edits to `openapi.json` / `src/types/openapi.ts`).

---

## 4. Profile widget — `AccountLimitsWidget`

### Placement
The Profile page (`src/app/(app)/profile/page.tsx`) already has a **server-rendered "Usage" card**
(items / collections / per-type counts). Plan:

- **Reuse that card's slot.** Add the new client widget as a sibling section under a **"Plan & Limits"**
  card, *below* the existing Usage counts (keep the existing per-type breakdown — it's complementary).
- The widget is `'use client'` and self-fetches via `$api` (no promise threaded from the server
  component), with a matching skeleton on first paint to avoid layout shift — exactly like
  `AiUsageWidget`.

### Hook: `src/hooks/use-account-limits.ts`
```ts
const ACCOUNT_LIMITS_PATH = '/account/limits' as const
export type AccountLimits = components['schemas']['AccountLimits']

export function useAccountLimits() {
  return $api.useQuery('get', ACCOUNT_LIMITS_PATH, undefined, {
    staleTime: 60_000,          // see context7 note below
    refetchOnWindowFocus: true,
    // NO refetchInterval — nothing slides on its own; counts change only on mutation
  })
}

export function useInvalidateAccountLimits(): () => void { /* same getdel-key pattern as useInvalidateAiUsage */ }
```

**context7 (TanStack Query) decisions:**
- **Not `staleTime: 'static'`.** `'static'` is for data that *never* changes while the app runs and it
  *blocks manual invalidation* — wrong here, because `quotas.used` changes when the user creates/deletes
  items or collections. Use a finite `staleTime` (60s) so the widget can be invalidated.
- **No polling.** Unlike AI usage (sliding windows that refill on their own), item/collection counts only
  change as a result of a user mutation — so refetch on **invalidation**, not on an interval.
- **Invalidate after count-changing mutations.** Item create/delete and collection create/delete hooks
  should call `useInvalidateAccountLimits()` (fire-and-forget, `refetchType: 'active'` → true no-op when
  the widget is unmounted, so it's safe to call unconditionally). The rate-limit "remaining" fields also
  refresh on that same invalidation.

### Rendering
- **Quotas** (items, collections): the AI-usage meter treatment — label, `used / limit` (or `used` +
  "Unlimited" badge for Pro), a thin progress bar (`min(100, used/limit*100)`); near-cap (≥ 80%) tints
  the bar to a warning color; Free users at the cap get an "Upgrade to Pro" affordance.
- **Static caps** (uploads, fields, tags): compact read-only rows / chips with human-formatted values
  (`formatBytes(FILE_MAX_BYTES)` → "10 MB"; "5 tags · 50 chars each"; allowed exts as small pills).
- **Rate limits**: three slim meter rows (`remaining / limit` + window label "/ hr"), reusing the
  meter + `formatRenewIn(resetAt)` popover from the AI Usage widget for the renewal countdown.
- Skin-agnostic: lives only on `/profile` (a plain `Card`), so no per-skin treatment map is needed
  (unlike the dashboard AI Usage widget).

---

## 5. Files touched (when implemented)

| File | Change |
|---|---|
| `src/lib/api/schemas/account.ts` | **new** — `accountLimitsOutput` Zod schema `[C]` |
| `src/lib/db/account-limits.ts` | **new** — `getAccountLimits(userId, isPro)` aggregator `[S]` |
| `src/lib/infra/rate-limit.ts` | add `getOperationalUsage(userId)` (non-consuming, fail-open) |
| `src/app/api/account/limits/route.ts` | **new** — `GET` route handler |
| `src/lib/api/openapi/paths.ts` | add `/account/limits` GET declaration |
| `src/hooks/use-account-limits.ts` | **new** — `useAccountLimits` + `useInvalidateAccountLimits` |
| `src/components/profile/account-limits-widget.tsx` | **new** — client widget + skeleton |
| `src/app/(app)/profile/page.tsx` | mount `<AccountLimitsWidget />` under the Usage card |
| hooks that create/delete items & collections | call `useInvalidateAccountLimits()` after success |
| `openapi.json`, `src/types/openapi.ts` | regenerated via `npm run openapi:gen` (no hand edits) |
| `src/lib/utils/format.ts` | reuse/add `formatBytes` if not present |

No DB schema / migration changes — all values already exist. No new env vars.

---

## 6. Verification plan

- `npm run lint`
- Tests (per repo rule — new server util/route needs Vitest): `src/lib/db/account-limits.test.ts`
  (counts + plan + config aggregation; Pro → `limit: null`; fail-open when limiters unavailable) and
  schema round-trip in `src/lib/api/schemas/account.test.ts`.
- `npm run openapi:gen` — confirm `/account/limits` + `AccountLimits` appear, no hand edits.
- `npm run test:run`.
- Playwright happy-path (UI behavior): Free account shows `used / cap` bars + static caps + rate-limit
  meters; create an item → widget count increments after invalidation; Pro account shows "Unlimited" for
  items/collections and the upload caps as enabled.
- `npm run build` (route + rendering change).

---

## 7. Open questions / notes

- **Reuse vs. replace the existing server "Usage" card.** This spec keeps it (per-type breakdown is
  useful) and adds "Plan & Limits" beneath. Alternative: fold the existing counts into the new widget and
  drop the server card to avoid two sources of the item/collection count. Decide at implementation.
- **Pro "unlimited" representation:** `limit: null` in the payload; the widget renders an "Unlimited"
  badge and hides the progress bar for that quota.
- **`displayNameMax` / password caps** are included in the payload for completeness but are low-value on a
  limits widget; may render only `uploads`/`fields`/`tags`/`quotas`/`rateLimits` and keep name/password
  caps out of the UI even though the route exposes them.
- Keep the four `ai*` per-feature buckets in the **AI Usage** widget — do **not** duplicate them here.
```
