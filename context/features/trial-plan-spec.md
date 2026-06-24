# Trial Plan — Feature Spec

> **Status:** Spec only (not implemented). Captures the design for a third plan, **Trial**, that grants
> the full Pro feature set under stricter usage limits, started manually by a non-Pro user, once ever.
>
> **Scope decisions (confirmed):**
> - **App-managed, no Stripe, no card.** The trial lives entirely in our DB. Stripe is involved only when
>   real money is paid (unchanged from today). See [§3](#3-why-app-managed-not-stripe-backed).
> - **Same Pro features, stricter limits.** Trial users get *every* Pro feature (files, images, brain dump,
>   AI, unlimited items/collections) — only the **rate limits** tighten. No feature is locked off.
> - **14-day window. Brain dump capped at 1/day** (paid Pro stays 1/hour). Other limits unchanged for now.
> - **User-initiated, non-Pro only, once per user ever.**

---

## 1. Goal

Add a `trial` tier between `free` and `pro`:

- A **non-Pro** user can **click to start** a 14-day free trial — no payment method, no Stripe.
- During the trial they have **all Pro features** but with **stricter quotas** (brain dump 1/day vs 1/hour).
- A user may start a trial **exactly once, ever** — even after it expires they cannot start a second.
- When the trial ends, the account silently reverts to `free` (Pro features re-gate), and the user can
  upgrade to paid Pro through the existing Stripe checkout flow at any time.

---

## 2. Current state (what exists today)

The plan model is **binary** — a single `User.isPro` boolean kept in sync by Stripe webhooks. There is no
notion of *which* plan grants Pro access, and limits are per-hour (not per-plan).

| Concern | Today | Source |
|---|---|---|
| Pro gate | `isPro` boolean; Pro iff `stripeSubscriptionId` set **and** `isPro` | [pro-access-resolution.ts:40-49](../../src/lib/billing/access/pro-access-resolution.ts) |
| Source of truth | Stripe webhooks write `isPro` | [subscription-access.ts](../../src/lib/billing/subscription/subscription-access.ts) |
| Brain dump limit | `aiBrainDump: { attempts: 1, window: '1 h' }`, keyed by `userId`, **same for all** | [rate-limit.ts:62](../../src/lib/infra/rate-limit.ts) |
| Pro feature gates | scattered `if (!isPro) return problem(403, …)` in route handlers | brain-dump / ai-usage / upload routes |
| Count caps | `FREE_TIER_ITEM_LIMIT` (50), `FREE_TIER_COLLECTION_LIMIT` (3), bypassed when `isPro` | [usage.ts](../../src/lib/db/usage.ts) |
| Client exposure | `userProfileFlagsSchema.isPro` | [schemas/profile.ts](../../src/lib/api/schemas/profile.ts) |

**Key fit:** trial users are `isPro: true`. So every existing `if (!isPro)` gate and every count-cap bypass
works **unchanged** for trial users. The only new dimension is *how* they became Pro, used solely to pick
the stricter limits.

---

## 3. Why app-managed, not Stripe-backed

The requirement "never force a card" + "once per user ever" + "user clicks to start" makes Stripe pure overhead.

| | App-managed (chosen) | Stripe-backed |
|---|---|---|
| Card required | **No** | Cardless trials exist, but you create a phantom `Subscription` per trial user |
| "Once ever" | one DB column (`trialStartedAt`, never cleared) | **Stripe does not enforce this** — you need the DB flag anyway |
| Expiry | own lazy check / backstop job | `customer.subscription.deleted` webhook tangled with paid-sub reconciliation |
| Convert to paid | normal checkout (clean) | Stripe converts trial-sub in place — collides with existing checkout |
| Blast radius | new columns + 1 tier-aware limit; **webhook reconciler untouched** | threads trial logic through the webhook handlers + persistence |

Stripe's only upside is native `trial_will_end` dunning — not worth phantom subscriptions and a more complex
reconciler. **Stripe's role stays exactly as today: it appears only when real money is involved.**

> **Context7 / Stripe docs confirm this** (`/stripe/stripe-node`, API `2025-03-31.basil`, SDK v18+):
> - Trials are **subscription-bound only** — `trial_period_days` / `trial_end` exist solely inside
>   `subscription_data` on a Checkout Session or `Subscription`. There is no free-standing "trial" object;
>   a cardless trial still mints a real `Subscription`.
> - The Stripe API has **no once-per-customer trial enforcement** — a DB flag is required either way.
> - **Breaking change in v18:** Checkout Sessions for subscriptions now **postpone subscription creation
>   until after payment completes**, making a cardless-trial-via-Checkout flow more awkward, not less.
>   This reinforces keeping the trial entirely app-side.

---

## 4. Data model

[prisma/schema.prisma](../../prisma/schema.prisma) — Neon **`dev`** branch migration only (never `production`).

```prisma
enum PlanTier { free  trial  pro }

model User {
  // ... existing billing fields unchanged
  planTier        PlanTier   @default(free)
  trialStartedAt  DateTime?   // set once when trial begins; NEVER cleared → enforces "once ever"
  trialEndsAt     DateTime?   // null when not on / past a trial
}
```

- `trialStartedAt != null` is the **permanent "already used your trial"** record. It must survive expiry —
  do **not** null it out on downgrade. This is the once-per-user guarantee.
- `planTier` is the discriminator: `free` (default), `trial` (active app trial), `pro` (paid Stripe sub).
- `isPro` is retained as the universal feature gate and remains `true` for both `trial` and `pro`.

**Invariant table:**

| planTier | isPro | stripeSubscriptionId | trialStartedAt | meaning |
|---|---|---|---|---|
| `free` | false | null | null | never trialed, free |
| `free` | false | null | set | trial used and expired, now free |
| `trial` | true | null | set | active app trial |
| `pro` | true | set | null or set | paid Pro (may have trialed earlier) |

---

## 5. Tier resolution & lazy expiry

Extend [pro-access-resolution.ts](../../src/lib/billing/access/pro-access-resolution.ts) so the same DB read
that resolves Pro access also resolves `planTier`, with a **lazy expiry** step:

- If `planTier === 'trial'` and `trialEndsAt < now`: downgrade the row in place —
  `planTier: 'free'`, `isPro: false`, **keep** `trialStartedAt`/`trialEndsAt` — then return `free`/not-Pro.
  Access self-corrects on the next request even with no cron.
- Paid Pro always wins: a row with an active Stripe sub resolves to `pro`/Pro regardless of trial fields.

Add a request-scoped resolver `getCachedUserPlanTier(userId): 'free' | 'trial' | 'pro'` alongside the
existing `getCachedVerifiedProAccess`, sharing the same cached DB read (extend the selected columns rather
than adding a second query).

**Backstop (optional, post-MVP):** a scheduled job to sweep expired trials so rows don't sit stale forever
for users who never return. Not required for correctness — lazy expiry covers the access path. Follow the
existing cron pattern ([upload-hardening-cron.md](upload-hardening-cron.md)) if added.

---

## 6. Plan-aware limits

[rate-limit.ts](../../src/lib/infra/rate-limit.ts) — make the brain dump limit depend on tier.

- `pro → { attempts: 1, window: '1 h' }` (unchanged)
- `trial → { attempts: 1, window: '1 d' }`

Implementation: register **two** brain-dump limiters with distinct Redis prefixes (`aiBrainDump` and
`aiBrainDumpTrial`) so windows never carry across a tier change, and resolve which key to use from the
caller's tier. Thread the tier from the route `ctx` into `checkRateLimit` / `getBrainDumpUsage`:

- [brain-dump/route.ts](../../src/app/api/ai/brain-dump/route.ts) — pick the limiter by tier before the check.
- [ai/usage/route.ts](../../src/app/api/ai/usage/route.ts) — `getBrainDumpUsage` reports the tier-correct
  `limit`/`window` so the dashboard meter shows "1 / day" for trial users.

The four per-feature AI limits (`AI_FEATURE_HOURLY_LIMIT`) stay shared for now; the same tier-aware pattern
can extend to them later if a trial AI throttle is wanted. Document that as out-of-scope here.

> **Context7 / Upstash docs confirm this** (`/websites/upstash_redis_sdks_ratelimit-`): separate
> `Ratelimit` instances with distinct `prefix` per tier is the **officially recommended** way to do
> per-plan limits — exactly what `getLimiters()` already does per key. Verbatim pattern:
> ```ts
> const ratelimit = {
>   free: new Ratelimit({ redis, prefix: 'ratelimit:free', limiter: Ratelimit.slidingWindow(10, '10s') }),
>   paid: new Ratelimit({ redis, prefix: 'ratelimit:paid', limiter: Ratelimit.slidingWindow(60, '10s') }),
> }
> await ratelimit.paid.limit(userId)
> ```
> **Do NOT use the newer `dynamicLimits` / `setDynamicLimit()` API** — it sets a *global* limit persisted in
> Redis (overriding for all users), built for runtime-tunable global limits, not per-request tier selection.
> The static two-limiter pattern is the correct fit.

---

## 7. Start-trial endpoint

New route `POST /api/billing/trial` (`authedRoute`), following the route-handler + `paths.ts` + Zod-schema +
`npm run openapi:gen` contract — **never** a Server Action, never a hand-edited generated type.

- **Rate limit:** new `startTrial` key in [rate-limit.ts](../../src/lib/infra/rate-limit.ts), keyed by `userId`
  (e.g. `{ attempts: 5, window: '1 h' }`).
- **Eligibility (all must hold):**
  1. `planTier === 'free'`
  2. `trialStartedAt === null` (never trialed)
  3. no active/canceled Stripe subscription (`stripeSubscriptionId === null`) — a paid/lapsed customer
     cannot route around billing via a trial.
- **On success** (single transactional update): `planTier: 'trial'`, `trialStartedAt: now`,
  `trialEndsAt: now + TRIAL_DURATION_DAYS`, `isPro: true`. Invalidate the billing/profile cache so the
  session JWT and sidebar pick up Pro immediately.
- **Ineligible:** `409` with a clear message ("Your free trial has already been used" / "You already have
  an active subscription"). `userId` always from session (IDOR-safe), never from input.

Eligibility resolution lives in `src/lib/billing/` (server-only), reusing the fresh DB read so it can't race
a cached value.

---

## 8. Client exposure & UI

- **Schema:** add `planTier` and `trialEndsAt` to `userProfileFlagsSchema`
  ([schemas/profile.ts](../../src/lib/api/schemas/profile.ts)) and to the billing context response, plus a
  derived `canStartTrial` boolean computed server-side from the eligibility rule.
- **Start CTA:** a "Start 14-day free trial" button on [upgrade/page.tsx](../../src/app/(app)/upgrade/page.tsx)
  and the billing settings card, shown **only when `canStartTrial`**. Calls `POST /api/billing/trial` via the
  typed `$api` client; the mutation's cache updater lives in the owning billing hook (per coding-standards),
  not in the component.
- **Active-trial banner:** when `planTier === 'trial'`, show days remaining (from `trialEndsAt`) and an
  "Upgrade to Pro" CTA into the existing Stripe checkout. Pricing/plan copy gains a Trial column.
- **Skeleton:** any new/changed page must still honor `?skeleton=true` per nextjs-architecture rules.

---

## 9. Constants

[constants.ts](../../src/lib/utils/constants.ts):

```ts
export const TRIAL_DURATION_DAYS = 14
// brain-dump trial window expressed where the limiter config reads it (rate-limit.ts)
```

---

## 10. Tests (mandatory — server actions/utils only)

Vitest coverage (no component tests), per project rules:

- **Eligibility:** allowed only when `free` + `trialStartedAt === null` + no Stripe sub; rejected for
  already-trialed, active-trial, and paid/lapsed users (`409`).
- **Once-ever:** after a trial expires, `canStartTrial` is `false` and `POST /api/billing/trial` returns `409`.
- **Lazy expiry:** a `trial` row past `trialEndsAt` resolves to `free`/not-Pro and is downgraded in place,
  with `trialStartedAt` **preserved**.
- **Tier-aware limit:** brain dump resolves to the 1/day limiter for `trial` and 1/hour for `pro`; the two
  keys use independent Redis prefixes.
- **Trial → paid promotion:** when a Stripe sub activates for a trial user, `planTier` becomes `pro` and Pro
  access is granted regardless of remaining trial time.
- **Webhook untouched:** existing Stripe webhook tests still pass (no behavioral change to the reconciler).

---

## 11. Out of scope

- Stripe native trials / `trial_period_days` / phantom subscriptions.
- Trial-specific throttling of the four hourly AI features (kept shared for MVP).
- Trial reminder emails (`trial_will_end`-style dunning) — could be added later via the backstop cron.
- Any change to free-tier count caps (50 items / 3 collections) — trial users are `isPro`, so uncapped.

---

## 12. Net surface

~3 new columns, 1 new route, 1 tier-aware limit (+ tier resolver), profile/UI plumbing. **Zero changes to
the Stripe webhook reconciler.** Every existing `if (!isPro)` gate works for trial users unchanged.
