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
  planTier            PlanTier   @default(free)
  trialStartedAt      DateTime?   // set once when trial begins; NEVER cleared → enforces "once ever"
  trialEndsAt         DateTime?   // null when not on / past a trial
  trialRemindersSent  String[]   @default([])  // sent reminder tags: 'started' | 't3' | 't1' | 'expired' (§10)
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

**Scheduled sweep (required — see §10):** a daily cron downgrades expired trials proactively (so rows don't
sit stale for users who never return) **and** drives the reminder emails (T-3, T-1, expiry). Lazy expiry
above still covers the access path on its own; the cron is what makes the time-relative emails possible.
Follow the existing cron pattern ([upload-hardening-cron.md](upload-hardening-cron.md)).

---

## 6. Plan-aware limits

Two surfaces become tier-aware: the brain-dump **rate limit** (§6a) and the item/collection **count caps**
(§6b).

### 6a. Rate limits

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

### 6b. Count caps (trial-specific)

Trial users get **their own** item/collection caps — stricter than paid Pro (unlimited), looser than free
(50 / 3). New constants in [constants.ts](../../src/lib/utils/constants.ts):

```ts
export const TRIAL_TIER_ITEM_LIMIT = 200        // example — confirm number at impl
export const TRIAL_TIER_COLLECTION_LIMIT = 10
```

**This requires the cap helpers to become tier-aware**, not just `isPro`-aware. Today
[usage.ts](../../src/lib/db/usage.ts) is binary:

```ts
canCreateItem(userId, isPro)        // isPro → unlimited, else < FREE_TIER_ITEM_LIMIT
canCreateCollection(userId, isPro)
```

Change the signature to take the resolved tier (or a resolved cap), so all three tiers branch:

```ts
// free → FREE cap · trial → TRIAL cap · pro → unlimited (null)
function itemCapForTier(tier: PlanTier): number | null { … }
canCreateItem(userId, tier)
canCreateCollection(userId, tier)
```

**Call-site impact — every consumer of the cap helpers must pass tier instead of `isPro`:**
- [items/route.ts](../../src/app/api/items/route.ts) POST, [collections/route.ts](../../src/app/api/collections/route.ts) POST
- [profile/me/route.ts](../../src/app/api/profile/me/route.ts) (`canCreateItem`/`canCreateCollection` flags)
- the `(app)/layout.tsx` chrome loader (`loadChromeData`)

Resolve the tier once via `getCachedUserPlanTier` (§5) at each call site — the same cached DB read, no extra
query. The error copy stays accurate per tier ("reached your trial limit of N items").

> **Note (Pro-only item types unchanged):** `file`/`image` stay gated by `isPro`, which trial users have —
> so trial users *can* create file/image items, just bounded by the trial count cap. Only the **counts**
> are trial-scoped, not the available item types.

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
- **On success — atomic conditional `updateMany`** (not read-then-update): fold the eligibility predicate
  into the `where` so two concurrent "start trial" calls can't both pass. `count === 0` ⇒ ineligible ⇒ `409`.
  ```ts
  const { count } = await prisma.user.updateMany({
    where: { id: userId, planTier: 'free', trialStartedAt: null, stripeSubscriptionId: null },
    data: { planTier: 'trial', isPro: true, trialStartedAt: now, trialEndsAt: trialEnd },
  })
  if (count === 0) return problem(409, 'Your free trial has already been used.')
  ```
  Then invalidate the billing/profile cache so the session JWT and sidebar pick up Pro immediately.
  This is the modern Prisma guidance (Context7 `/websites/prisma_io`): prefer a single atomic conditional
  write over an interactive `$transaction` read-then-write when the check can be expressed as a `where`.
- **Ineligible:** `409` with a clear message. `userId` always from session (IDOR-safe), never from input.

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

`planTier` + `trialEndsAt` on the profile flags also feed the login toast (§9). Reuse them — do not add a
second client read.

---

## 9. Login reminder toast (tier-aware)

On **each login** the user sees a single toast whose copy depends on their tier and trial eligibility.
Toasts use **Sonner** (`toast.info(...)`, mounted in `root-provider-shell.tsx`); a Sonner toast can carry an
`action` button for the CTA.

### Per-tier copy

| Tier / state | Toast | CTA → |
|---|---|---|
| `trial` (active) | "{N} days left in your free trial" | "Upgrade to Pro →" → `/upgrade` |
| `free`, `canStartTrial === true` | "Try Pro free for 14 days" | "Start free trial →" → `/upgrade` |
| `free`, already trialed (`!canStartTrial`) | "Unlock Pro features" | "Upgrade to Pro →" → `/upgrade` |
| `pro` (paid) | light thank-you (e.g. "Welcome back 👋") | none — **no upsell** |

The component branches on `planTier` + `canStartTrial` (already on the profile flags). Use an early-return
or a small lookup, **no nested ternaries** in JSX (coding-standards). The trial variant computes days-left
(below); the others are static copy.

### Critical distinction: once per **login**, not once per **render**

The natural mount point — `AppUserFlagsInitializer` ([app-user-flags-initializer.tsx](../../src/components/shared/app-user-flags-initializer.tsx)) —
remounts on **every authenticated page load and every full browser refresh**. A bare `useRef` "show once"
guard is component-instance-scoped, so it would re-fire the toast on every hard refresh and every layout
remount. That is render-spam, not a login reminder. We need a marker that resets **once per authenticated
session**, not per component mount.

### Source-of-truth marker: the NextAuth session, not client storage

Project rule (saved feedback): **persist state in the DB, never localStorage/cookies**. A login is a NextAuth
event, so the correct "fire once per login" key is the **session/JWT itself**, established server-side in the
`jwt`/`session` callbacks ([auth.ts](../../src/auth.ts)) — not a browser flag.

**Approach (recommended):** stamp a one-shot signal on the JWT at sign-in.
- In the `jwt` callback, on the **sign-in trigger only** (NextAuth passes `user`/`trigger: 'signIn'` only on
  initial sign-in, not on subsequent token refreshes), set a transient `token.freshLogin = true`.
- The `session` callback surfaces it as `session.user.freshLogin` for that first read, then it naturally
  falls away on later token refreshes (don't re-set it).
- A small client initializer reads `freshLogin` **and** the profile flags; if `freshLogin`, it fires the
  tier-appropriate toast (table above) **once**, guarded by a `useRef` so React strict-mode double-invoke or
  a same-session re-render can't double-fire within that mount.

This ties the toast to the *authentication event* (correct semantics) and stores nothing client-side.

> If stamping the JWT proves awkward, the fallback is a `sessionStorage` "shown this tab-session" flag — but
> that is **explicitly dispreferred** here: it violates the no-client-storage rule and is per-tab, not
> per-login. Treat it only as a last resort and flag it for review.

### Days-left computation

Compute from `trialEndsAt` server-consistently: `daysLeft = ceil((trialEndsAt − now) / 1 day)`, clamped at
`>= 0`. Pull the formatter into a tested util (it's pure and used by both the toast and the active-trial
banner) rather than inlining the date math in the component.

### Edge cases

- **Trial expired between sessions:** lazy expiry (§5) downgrades to `free` before the profile read, so the
  user falls into the `free` row of the table (start-trial if still eligible, else upgrade) — never the
  trial-days copy. Correct.
- **Last day:** `daysLeft === 1` → "1 day left" (singular); `0` (expires today) → "expires today". Handle the
  copy in the util, no nested ternaries in JSX (coding-standards).
- **Pro thank-you:** keep it light and **upsell-free**; this is the one tier with no CTA.

---

## 10. Trial reminder emails

Four transactional emails over the trial lifecycle, all funneled through `sendEmail()`
([resend.ts](../../src/lib/infra/resend.ts)) — **never** the Resend SDK directly, and they **no-op** when
`DISABLE_EMAIL_VERIFICATION=true` (security rule). New senders live in
[src/lib/emails/](../../src/lib/emails/) alongside the existing billing senders.

| Trigger | When | Driven by |
|---|---|---|
| **Trial started** | immediately on `POST /api/billing/trial` success | the endpoint (synchronous, §7) |
| **3 days before end** | `trialEndsAt` within ~72h, not yet sent | daily cron (§11) |
| **1 day before end** | `trialEndsAt` within ~24h, not yet sent | daily cron (§11) |
| **Trial expired** | `trialEndsAt < now`, on the downgrade | daily cron (§11) |

Each reminder links to `/upgrade` (Stripe checkout). Copy mirrors the existing billing email tone.

### Idempotency (don't double-send)

The cron runs daily and lazy expiry can downgrade a row before the cron sees it, so sends must be **guarded**.
Track which reminders a trial has already received with a small marker rather than re-deriving from dates:

```prisma
model User {
  // ...
  trialRemindersSent  String[]  @default([])   // e.g. ['t3','t1','expired']
}
```

The cron (and the start-trial endpoint for `'started'`) appends the tag in the **same update** that sends,
so a missed/duplicate cron tick never re-sends. This is the email analogue of the once-ever `trialStartedAt`
guard. (Alternative: a Redis "sent" key per `userId:reminder` with a TTL past trial end — but the array
column keeps it in one place with the trial state and survives Redis eviction.)

---

## 11. Expiry & reminder cron (Vercel)

A single **daily** Vercel cron, following the repo's planned cron convention
([upload-hardening-cron.md](upload-hardening-cron.md)). Work performed each run:

1. **Downgrade** every `trial` row past `trialEndsAt` → `planTier: 'free'`, `isPro: false` (keep
   `trialStartedAt`). Idempotent with lazy expiry (§5) — whichever runs first wins; the other no-ops.
2. **Send T-3 / T-1 reminders** for active trials entering those windows, appending the marker (§10).
3. **Send the expiry email** on the downgrade, appending `'expired'`.

All sends go through `sendEmail()` (kill-switch honored). One query selects the candidate rows
(`planTier = 'trial'` with `trialEndsAt` in the relevant ranges); work is batched and each user's
state+marker update is atomic. Keep the tier/email logic in `src/lib/billing/` so the route is a thin wrapper.

### 11a. `vercel.json` (repo root — new file)

Per Vercel docs (Context7 `/websites/vercel`), declare the cron in the `crons` array. Daily at 06:00 UTC:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    { "path": "/api/cron/trial-lifecycle", "schedule": "0 6 * * *" }
  ]
}
```

- **Schedule** is standard cron syntax in **UTC**. `0 6 * * *` = once daily at 06:00 UTC. (Daily cron is on
  every plan; sub-daily frequency needs Pro.)
- If the upload-hardening cron also lands, it's a **second entry in the same array** — `vercel.json` holds
  one shared `crons` list, not one file per job.
- **`maxDuration`** (optional but recommended here): this job fans out emails, so bump the route's function
  budget if a run could exceed the default. Add under `functions`:
  ```json
  { "functions": { "src/app/api/cron/trial-lifecycle/route.ts": { "maxDuration": 60 } } }
  ```
  Tune the number to batch size; keep batches bounded so a single run stays within budget.

### 11b. Route exposure & auth — `GET /api/cron/trial-lifecycle`

Vercel invokes cron paths with `GET` and an `Authorization: Bearer ${CRON_SECRET}` header. The route is
**public-facing** (no user session), so it must verify that secret itself before doing any work — the
canonical Vercel check (Context7):

```ts
// src/app/api/cron/trial-lifecycle/route.ts
export const GET = publicRoute(async ({ request }) => {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) return problem(401, 'Unauthorized')

  await runTrialLifecycle()   // downgrade + reminders, all in src/lib/billing/
  return json({ ok: true })
})
```

- Use `publicRoute` (no auth gate) + the **manual `CRON_SECRET` bearer check** — not `authedRoute` (there is
  no user session on a cron call). The secret check is the entire access control.
- **`CRON_SECRET` is Vercel-managed and pre-configured** — per project rules it is **not** added to
  `env.d.ts` or `.env.example`. Vercel injects it into the deployment env and signs the cron request with it;
  locally it's simply unset, so the route 401s unless you export it by hand for a manual test.
- The work is **idempotent** (markers in §10, lazy-expiry overlap in §5), so a retried or double-fired
  invocation is safe.

---

## 12. Constants

[constants.ts](../../src/lib/utils/constants.ts):

```ts
export const TRIAL_DURATION_DAYS = 14
export const TRIAL_TIER_ITEM_LIMIT = 200          // confirm at impl
export const TRIAL_TIER_COLLECTION_LIMIT = 10     // confirm at impl
export const TRIAL_REMINDER_DAYS = [3, 1] as const // T-3, T-1 before trialEndsAt
// brain-dump trial window expressed where the limiter config reads it (rate-limit.ts)
```

---

## 13. Tests (mandatory — server actions/utils only)

Vitest coverage (no component tests), per project rules:

- **Eligibility:** allowed only when `free` + `trialStartedAt === null` + no Stripe sub; rejected for
  already-trialed, active-trial, and paid/lapsed users (`409`).
- **Once-ever:** after a trial expires, `canStartTrial` is `false` and `POST /api/billing/trial` returns `409`.
- **Lazy expiry:** a `trial` row past `trialEndsAt` resolves to `free`/not-Pro and is downgraded in place,
  with `trialStartedAt` **preserved**.
- **Tier-aware rate limit:** brain dump resolves to the 1/day limiter for `trial` and 1/hour for `pro`; the
  two keys use independent Redis prefixes.
- **Tier-aware count caps:** `canCreateItem`/`canCreateCollection` return the right boolean at each tier —
  free (50/3), trial (`TRIAL_TIER_*`), pro (unlimited); the cap helper maps tier → cap correctly.
- **Trial → paid promotion:** when a Stripe sub activates for a trial user, `planTier` becomes `pro` and Pro
  access is granted regardless of remaining trial time.
- **Webhook untouched:** existing Stripe webhook tests still pass (no behavioral change to the reconciler).
- **Days-left util (§9):** `ceil` rounding, clamp at `0`, singular "1 day" / "expires today" copy across the
  boundary timestamps. (Pure util — the toast component itself is not unit-tested, per the no-component-test rule.)
- **freshLogin marker:** the `jwt` callback sets `freshLogin` only on the sign-in trigger and not on token
  refresh, so the toast fires once per login.
- **Toast copy selection:** tier+eligibility → correct variant (trial-days / start-trial / upgrade / pro
  thank-you) via the pure selection util.
- **Reminder idempotency:** the cron does not re-send a reminder whose tag is already in
  `trialRemindersSent`; the start-trial endpoint appends `'started'`.
- **Email kill-switch:** with `DISABLE_EMAIL_VERIFICATION=true`, every trial email no-ops via `sendEmail()`
  (returns `'skipped'`, no Resend call).
- **Cron downgrade:** the daily job downgrades expired trials and is idempotent with lazy expiry (running
  both leaves the row in one consistent `free` state).
- **Cron auth:** the route returns `401` when the `Authorization` header is missing or not
  `Bearer ${CRON_SECRET}`, and only runs the lifecycle work when it matches.

---

## 14. Out of scope

- Stripe native trials / `trial_period_days` / phantom subscriptions.
- Trial-specific throttling of the four hourly AI features (kept shared for MVP).

---

## 15. Net surface

~4 new columns (`planTier`, `trialStartedAt`, `trialEndsAt`, `trialRemindersSent`), 1 start-trial route,
1 daily Vercel cron route + a new repo-root `vercel.json` (`crons` entry, optional `maxDuration`), tier-aware
rate limit + tier-aware count caps (signature change to `usage.ts` + its call sites), 4 trial emails, a
`freshLogin` JWT marker + a tier-aware client toast, profile/UI plumbing. **Zero changes to the Stripe
webhook reconciler.** Every existing `if (!isPro)` gate works for trial users unchanged (only the count caps
and brain-dump rate become tier-aware). `CRON_SECRET` is Vercel-managed — no new env declarations.
