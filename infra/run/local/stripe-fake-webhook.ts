/**
 * Fully OFFLINE Stripe webhook trigger — grants Pro to a local user with no Stripe
 * account and no network. See infra/docs/07-local-run.md ("Білінг").
 *
 * Why this works: `/api/webhooks/stripe` only trusts the `stripe-signature` header,
 * which is a plain HMAC-SHA256 of (payload + STRIPE_WEBHOOK_SECRET). The Stripe SDK's
 * own `webhooks.generateTestHeaderString()` produces exactly that signature offline —
 * the handler cannot tell it apart from a real Stripe delivery.
 *
 * Why `customer.subscription.updated` (not `checkout.session.completed`): the checkout
 * handler re-fetches the subscription from the live Stripe API (would throw offline).
 * The subscription-upsert path reads everything off the inline event object
 * (`upsertSubscriptionStateFromObject`): metadata.userId, status, items[].current_period_end,
 * start_date — zero Stripe round-trips. The only DB reads are getUserById + the
 * local subscription link check, so a real local user id is all that's required.
 *
 * Usage (app must be reachable; defaults target the kind NodePort on :8080):
 *   STRIPE_WEBHOOK_SECRET=whsec_local_test \
 *     npx tsx infra/run/local/stripe-fake-webhook.ts <userId> [active|canceled|past_due]
 *
 *   APP_URL=http://localhost:8080 overrides the target.
 *
 * Get a local userId from Postgres, e.g.:
 *   kubectl exec -n devstash statefulset/postgres -- \
 *     psql -U devstash -d devstash -c "SELECT id, email FROM users;"
 */
import Stripe from 'stripe'

const userId = process.argv[2]
const status = (process.argv[3] ?? 'active') as Stripe.Subscription.Status

if (!userId) {
  console.error('Usage: npx tsx infra/run/local/stripe-fake-webhook.ts <userId> [status]')
  process.exit(1)
}

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
if (!webhookSecret) {
  console.error('STRIPE_WEBHOOK_SECRET is required (must match the value in the app Secret, e.g. whsec_local_test).')
  process.exit(1)
}

const appUrl = process.env.APP_URL ?? 'http://localhost:8080'

// No API key is ever used — we only call the offline signing helper. The dummy key
// satisfies the constructor; no network request is made by generateTestHeaderString.
const stripe = new Stripe('sk_test_offline_unused', { apiVersion: '2026-06-24.dahlia' })

const nowSec = Math.floor(Date.now() / 1000)
const periodEndSec = nowSec + 30 * 24 * 60 * 60 // +30 days

// Minimal but field-complete subscription object for the upsert path. User
// resolution prefers metadata.userId (no Stripe call). A fake `customer` id is
// REQUIRED: the backfill that writes stripeSubscriptionId onto the user row only
// runs when BOTH userId and customerId are present (applySubscriptionStateWithBackfill);
// without it the link check throws. The id is local-only — resolveAppUserIdForSubscription
// just does a harmless DB lookup that misses, then falls back to metadata.userId.
// The price item carries a recurring interval so getPrimarySubscriptionItem/
// getIntervalFromSub resolve without real price IDs.
const subscription = {
  id: `sub_offline_${userId.slice(0, 12)}`,
  object: 'subscription',
  customer: `cus_offline_${userId.slice(0, 12)}`,
  status,
  start_date: nowSec,
  cancel_at_period_end: false,
  metadata: { userId },
  items: {
    object: 'list',
    data: [
      {
        id: 'si_offline_1',
        object: 'subscription_item',
        current_period_end: periodEndSec,
        price: {
          id: 'price_offline_monthly',
          object: 'price',
          recurring: { interval: 'month' },
        },
      },
    ],
  },
}

const event = {
  id: `evt_offline_${nowSec}`,
  object: 'event',
  type: 'customer.subscription.updated',
  api_version: '2026-06-24.dahlia',
  created: nowSec,
  data: { object: subscription },
}

const payload = JSON.stringify(event)
const header = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret })

const target = `${appUrl}/api/webhooks/stripe`
console.log(`POST ${target}  (event=${event.type} status=${status} user=${userId})`)

const res = await fetch(target, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'stripe-signature': header },
  body: payload,
})

const text = await res.text()
console.log(`HTTP ${res.status} ${text}`)

if (!res.ok) {
  console.error('Webhook was rejected. Check that STRIPE_WEBHOOK_SECRET matches the app Secret and the userId exists.')
  process.exit(1)
}
console.log(`Done — user ${userId} should now have Pro (status=${status}).`)
