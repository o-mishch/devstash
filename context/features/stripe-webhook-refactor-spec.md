# Stripe Webhook Refactor: Shift Provisioning to Subscription Events

**Goal:** Remove the reliance on `checkout.session.completed` for Pro access provisioning. Instead, treat `customer.subscription.created` and `customer.subscription.updated` as the authoritative source of subscription state. This eliminates an extra Stripe API call per checkout and makes provisioning event-driven rather than checkout-session-driven.

---

## Status

| Task | Status |
|---|---|
| Add `subscription_data.metadata.userId` to `createCheckoutSession` | ✅ Done |
| Remove `fetchSubscriptionOnCheckout` extra API call | ✅ Done (replaced by `fetchSubscriptionDetails` inside `persistSubscriptionFromStripe`) |
| `updateSubscriptionState` accepts `isPro` | ✅ Done (field is part of `UpdateSubscriptionStateData`) |
| Add `customer.subscription.created` handler | ❌ Pending |
| Add `customer.subscription.updated` handler | ❌ Pending |
| Remove `checkout.session.completed` provisioning | ❌ Pending — **blocked on Open Question below** |

---

## Decision Required Before Implementation

> **Q: Should we support asynchronous payment methods (SEPA, Boleto, ACH Debit, etc.)?**
>
> This choice determines whether we can remove `checkout.session.completed` at all:
>
> - **Yes (support async methods):** Keep `checkout.session.completed` but strip provisioning from it. Rely on `customer.subscription.created` for standard card payments (status `active`) and `checkout.session.async_payment_succeeded` for delayed payments. This is the most robust long-term path.
> - **No (card-only for now):** Subscriptions always start `active` immediately. Safe to remove `checkout.session.completed` provisioning entirely and rely solely on `customer.subscription.created`.
>
> **Current behaviour:** `handleCheckoutSessionCompleted` calls `persistSubscriptionFromStripe` which accepts `paymentStatus` and `forceActivate` to handle `paid` vs `unpaid` vs `no_payment_required` states. Removing it breaks async payment method support if that's ever enabled.

---

## Current Architecture (as of this writing)

### File locations

| What | Path |
|---|---|
| Stripe SDK + session creation | `src/lib/stripe/index.ts` |
| Webhook route (entry point) | `src/app/api/webhooks/stripe/route.ts` |
| All webhook event handlers | `src/lib/billing/webhook/stripe-webhook-event-handlers.ts` |
| Subscription persist orchestrator | `src/lib/billing/subscription/stripe-subscription-persist.ts` |
| DB subscription helpers | `src/lib/db/stripe.ts` |

### Current checkout flow

```
checkout.session.completed
  → handleCheckoutSessionCompleted(session, forceActivate=false)
    → resolves userId from session.client_reference_id
         or subscription.metadata.userId (fallback via resolveAppUserIdForSubscription)
    → persistSubscriptionFromStripe(userId, subscriptionId, customerId, forceActivate, paymentStatus)
      → fetchSubscriptionDetails(subscriptionId)   ← one Stripe API call
      → applySubscriptionAccessFromStripe(...)     ← writes DB + cache
```

### What does NOT exist yet

- No `customer.subscription.created` case in the event handler switch
- No `customer.subscription.updated` case in the event handler switch
- `handleCheckoutSessionCompleted` is still the provisioning entry point

---

## Proposed Changes

### 1. Add `customer.subscription.created` handler

**File:** `src/lib/billing/webhook/stripe-webhook-event-handlers.ts`

Add a new handler after the existing checkout handlers section. Pattern follows how `invoice.paid` accesses subscription data — via `fetchSubscriptionDetails`.

```ts
export async function handleSubscriptionCreated(subscription: Stripe.Subscription) {
  const userId = subscription.metadata?.userId ?? null
  if (!userId) {
    log.warn('subscription.created: no userId in metadata, skipping provisioning', {
      subscriptionId: subscription.id,
    })
    return
  }

  const customerId = getStripeCustomerId(subscription.customer)
  const persistResult = await persistSubscriptionFromStripe(
    userId,
    subscription.id,
    customerId,
    false,            // forceActivate: false — respect actual subscription.status
    null,             // paymentStatus: null — not a checkout session context
  )
  if (!persistResult.persisted) {
    throw new Error(
      `handleSubscriptionCreated: failed to persist subscription ${subscription.id} for user ${userId}`,
    )
  }
}
```

Add to the switch in `routeStripeWebhookEvent`:
```ts
case 'customer.subscription.created':
  await handleSubscriptionCreated(event.data.object as Stripe.Subscription)
  break
```

### 2. Add `customer.subscription.updated` handler

Same file. This handles transitions: `incomplete` → `active`, trial end, plan changes.

```ts
export async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const userId = subscription.metadata?.userId ?? null
  if (!userId) {
    log.warn('subscription.updated: no userId in metadata, skipping', {
      subscriptionId: subscription.id,
    })
    return
  }

  const customerId = getStripeCustomerId(subscription.customer)
  const persistResult = await persistSubscriptionFromStripe(
    userId,
    subscription.id,
    customerId,
    false,
    null,
  )
  if (!persistResult.persisted) {
    throw new Error(
      `handleSubscriptionUpdated: failed to persist subscription ${subscription.id} for user ${userId}`,
    )
  }
}
```

Add to the switch:
```ts
case 'customer.subscription.updated':
  await handleSubscriptionUpdated(event.data.object as Stripe.Subscription)
  break
```

### 3. Add events to webhook config allowlist

**File:** `src/lib/billing/config/stripe-webhook-config.ts`

Add to the `REQUIRED_STRIPE_WEBHOOK_EVENTS` array:
```ts
'customer.subscription.created',
'customer.subscription.updated',
```

### 4. Remove `checkout.session.completed` provisioning — conditional on Decision above

**Only do this step after the Open Question above is answered.**

If removing:
- Delete `handleCheckoutSessionCompleted` from `stripe-webhook-event-handlers.ts`
- Remove the `checkout.session.completed` case from the switch (keep `async_payment_succeeded/failed/expired` cases — they are separate)
- Remove `checkout.session.completed` from `REQUIRED_STRIPE_WEBHOOK_EVENTS`

If keeping (async payment method support):
- Keep `handleCheckoutSessionCompleted` but have it only handle the `unpaid` → `paid` transition after async confirmation
- `customer.subscription.created` becomes the primary provisioning path for immediate-pay checkouts

---

## Verification Plan

### Tests to write

**File:** `src/lib/billing/webhook/stripe-webhook-event-handlers.test.ts`

- `handleSubscriptionCreated`: grants access when status is `active`, skips when `metadata.userId` is missing, throws when `persistSubscriptionFromStripe` fails
- `handleSubscriptionUpdated`: updates state correctly on `incomplete` → `active` transition

**Run:**
```bash
npm run lint && npm run test:run
```

### Manual verification (Stripe CLI)

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
stripe trigger customer.subscription.created
```

Check server logs for `subscription.created` event processed, DB row updated, `isPro = true`.

---

## Security Hardening Backlog

Independent of the refactor above. These are hardening tasks from a best-practices audit. Do not implement during the webhook refactor.

### 1. Migrate to Restricted API Key (RAK) — medium priority

`STRIPE_SECRET_KEY` holds a full `sk_...` key. Replace with a RAK (`rk_...`) scoped to only what the app uses.

**Required permissions:**

| Resource | Permission |
|---|---|
| Checkout Sessions | Write |
| Billing Portal Sessions | Write |
| Subscriptions | Read + Write |
| Customers | Read + Write |
| Invoices | Read |
| Charges | Read |
| Disputes | Read |
| Webhook Endpoints | Read |

**Steps:**
1. Stripe Dashboard → Developers → API Keys → Create restricted key
2. Test in dev: run checkout + portal flow, check `stripe logs tail` for 403s
3. Replace `STRIPE_SECRET_KEY` value in Vercel env + local `.env` — no source code changes needed

### 2. IP allowlist on API key — low priority

Lock key to Vercel's outbound IP ranges (deterministic per region). A stolen key becomes unusable outside the hosting infra.

**Steps:**
1. Find Vercel outbound IPs for the deployment region
2. Stripe Dashboard → API key → IP allowlist → add CIDRs

### 3. Pre-commit hook for key leakage — low priority

```sh
# .git/hooks/pre-commit
if git diff --cached --diff-filter=ACM | grep -qE '(sk_live_|rk_live_)'; then
  echo "ERROR: Stripe live key in staged changes. Remove it before committing."
  exit 1
fi
```
