# Refactor Stripe Webhook Fulfilling

This plan outlines the steps to remove the extra Stripe API call (`fetchSubscriptionOnCheckout`) from the webhook handler. We will shift the subscription provisioning logic from the `checkout.session.completed` event to the `customer.subscription.created` and `customer.subscription.updated` events. 

By attaching the `userId` directly to the subscription's metadata during the checkout session creation, we ensure the subscription webhooks have all the context they need to provision the user's Pro access without needing to fetch additional objects from Stripe.

## User Review Required

> [!WARNING]
> This changes the core provisioning flow for Stripe subscriptions. Currently, a user gets "Pro" access as soon as the `checkout.session.completed` event is received. With this change, they will get "Pro" access when `customer.subscription.created` or `customer.subscription.updated` fires with an `active` or `trialing` status. This is a more robust pattern, but it's important to be aware of the shift in event reliance.

## Open Questions

> [!IMPORTANT]
> - Do you plan on supporting asynchronous payment methods (like SEPA, Boleto, etc.) in the future? Checking for `status === 'active'` gracefully supports them by waiting until payment clears, whereas the old approach would incorrectly grant immediate access.

## Proposed Changes

---

### Stripe Service Layer (`src/lib/stripe.ts`)

Modify the checkout session creation to explicitly embed the `userId` in the subscription metadata, so that subsequent subscription events carry this data.

#### [MODIFY] [stripe.ts](file:///Users/amishchenko/repos/devstash/src/lib/stripe.ts)
- In `createCheckoutSession`, add `subscription_data: { metadata: { userId: params.userId } }`.
- Remove the `fetchSubscriptionOnCheckout` function as it will no longer be needed.

---

### Database Layer (`src/lib/db/stripe.ts`)

Update the state updater function so it can toggle `isPro` when a subscription transitions from `incomplete` to `active`.

#### [MODIFY] [stripe.ts](file:///Users/amishchenko/repos/devstash/src/lib/db/stripe.ts)
- Update `updateSubscriptionState` signature to accept an optional `isPro?: boolean`.
- Ensure the Prisma `updateMany` call includes `isPro` when it is provided.

---

### Webhook Handlers (`src/app/api/webhooks/stripe/route.ts`)

Shift the source of truth for provisioning from the Checkout Session to the Subscription object itself.

#### [MODIFY] [route.ts](file:///Users/amishchenko/repos/devstash/src/app/api/webhooks/stripe/route.ts)
- Delete the `handleCheckoutSessionCompleted` function completely.
- Remove `checkout.session.completed` case from the switch statement (or change it to just a logging statement).
- Add a new function `handleSubscriptionCreated(subscription: Stripe.Subscription)`.
  - Extract `userId` from `subscription.metadata.userId`.
  - If `userId` is present, call `updateUserStripeSubscription`.
  - Set `isPro` to true **only** if `subscription.status === 'active'` or `subscription.status === 'trialing'`.
- In `handleSubscriptionUpdated`:
  - When updating the subscription state for an active subscription, pass `isPro: true` to `updateSubscriptionState` to handle the transition from `incomplete` -> `active`.

## Verification Plan

### Automated Tests
- Run `npm run test:run` to ensure Vitest utilities tests are unaffected by the database layer changes.

### Manual Verification
- Go through a local checkout flow.
- Ensure `customer.subscription.created` successfully provisions Pro access (since test card payments clear immediately).
- Check the database to confirm `stripeCustomerId`, `stripeSubscriptionId`, `subscriptionInterval`, `subscriptionStart`, and `isPro` are accurately populated.
