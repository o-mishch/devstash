# Stripe Phase 3: Embedded Checkout with Stripe Elements

## 1. Overview

Phase 3 replaces the Phase 2 hosted-checkout redirect with an embedded payment form built on Stripe Elements. Instead of sending the user to a Stripe-hosted page and back, the entire upgrade flow happens inside a modal within `/settings`. The user never leaves the app.

### Why Replace Hosted Checkout

| Dimension | Phase 2 (Hosted Checkout) | Phase 3 (Stripe Elements) |
|---|---|---|
| User experience | Redirect away and back | Stays in app — modal dialog |
| UI control | Stripe's branded page | Matches DevStash design system |
| Publishable key | Not needed | Required (`NEXT_PUBLIC_`) |
| Complexity | Low | Moderate |
| Payment methods | Stripe decides | You configure |
| 3DS / redirects | Stripe handles silently | `redirect: 'if_required'` handles cards without redirect |

---

## 2. Subscription Flow Architecture

Phase 3 uses a **SetupIntent → server-side Subscription** pattern. This is Stripe's recommended approach for SaaS subscriptions where you want to separate "save payment method" from "charge the customer".

```
[User clicks "Upgrade to Pro"]
         │
         ▼
POST /api/stripe/setup-intent          ← Server: find/create Stripe Customer,
    returns { clientSecret }              create SetupIntent (usage: 'off_session')
         │
         ▼
<CheckoutModal> opens
<Elements stripe={promise} options={{ clientSecret, appearance }}>
  <PaymentForm />                       ← Stripe iframe — card details never touch our server
</Elements>
         │
    [User submits]
         │
         ▼
elements.submit()                       ← Validates form fields client-side
         │
stripe.confirmSetup({                   ← Authorizes the payment method with Stripe
  elements,                               No charge happens yet
  redirect: 'if_required',               Cards: stays in app. Redirect-only methods: goes to return_url
})
         │
    { setupIntent.status === 'succeeded', setupIntent.payment_method: 'pm_...' }
         │
         ▼
POST /api/stripe/subscribe              ← Server: create Subscription with default_payment_method
    { paymentMethodId }                   First invoice charged immediately
    returns { subscriptionId }            DB updated: isPro = true, stripeSubscriptionId = ...
         │
         ▼
toast.success("Welcome to DevStash Pro!")
router.refresh()                        ← Session re-hydrates isPro from DB via NextAuth JWT callback
modal closes
         │
         ▼
[Stripe fires webhooks in parallel]
  customer.subscription.created  ─────► webhook handler — idempotent DB upsert (safety net)
  invoice.payment_succeeded       ─────► webhook handler — idempotent DB upsert (safety net)
```

**Why two DB update paths?** The subscribe API route gives immediate UI feedback. The webhook acts as a durability guarantee — if the user closes the tab between the Stripe confirmation and the subscribe call, the webhook still activates their account.

---

## 3. Environment Variables

Add to `.env` and all deployment environments:

```env
# Already exists in Phase 2 — restore to env.d.ts
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...

# Keep from Phase 2
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID_MONTHLY=price_...
```

Remove from `.env` (no longer needed):
```env
# STRIPE_PUBLISHABLE_KEY=pk_test_...   ← delete — was a non-NEXT_PUBLIC duplicate
# STRIPE_PRICE_ID_YEARLY=price_...     ← delete unless annual billing is in scope
```

Update `src/types/env.d.ts`:
```ts
declare namespace NodeJS {
  interface ProcessEnv {
    // ... existing vars ...
    STRIPE_WEBHOOK_SECRET: string
    STRIPE_SECRET_KEY: string
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: string  // restored — needed for loadStripe()
    STRIPE_PRICE_ID_MONTHLY: string
  }
}
```

---

## 4. New Packages

```bash
npm install @stripe/stripe-js @stripe/react-stripe-js
```

- `@stripe/stripe-js` — `loadStripe()`, runs in browser, loads `stripe.js` from Stripe CDN
- `@stripe/react-stripe-js` — `<Elements>`, `<PaymentElement>`, `useStripe`, `useElements` hooks

**Important:** Call `loadStripe()` outside of any React component render cycle to avoid recreating the Stripe object on every render. Create a singleton module:

```ts
// src/lib/stripe-client.ts
import { loadStripe } from '@stripe/stripe-js'

export const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!
)
```

---

## 5. New API Routes

### 5a. `POST /api/stripe/setup-intent`

**File:** `src/app/api/stripe/setup-intent/route.ts`

Creates a Stripe Customer (or retrieves the existing one) and creates a SetupIntent. Returns the `clientSecret` to the browser.

```ts
import { ApiResponse, authenticatedRoute } from '@/lib/api'
import { stripe } from '@/lib/stripe'
import { getOrCreateStripeCustomer } from '@/lib/db/stripe'

export const POST = authenticatedRoute(async (_req, _ctx, { userId }) => {
  const customer = await getOrCreateStripeCustomer(userId)

  const setupIntent = await stripe.setupIntents.create({
    customer: customer.stripeCustomerId,
    usage: 'off_session',   // payment method will be used for future off-session charges
    automatic_payment_methods: { enabled: true },
  })

  return ApiResponse.OK({ clientSecret: setupIntent.client_secret })
})
```

**Response shape:** `ApiBody<{ clientSecret: string }>`

### 5b. `POST /api/stripe/subscribe`

**File:** `src/app/api/stripe/subscribe/route.ts`

Called after `confirmSetup` succeeds on the client. Creates the Stripe Subscription and immediately updates the DB.

```ts
import { z } from 'zod'
import { ApiResponse, authenticatedRoute } from '@/lib/api'
import { stripe } from '@/lib/stripe'
import { getOrCreateStripeCustomer, updateUserStripeSubscription } from '@/lib/db/stripe'

const bodySchema = z.object({ paymentMethodId: z.string().min(1) })

export const POST = authenticatedRoute(async (req, _ctx, { userId }) => {
  const raw = await req.json()
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) return ApiResponse.BAD_REQUEST('Invalid payload.')

  const { paymentMethodId } = parsed.data
  const customer = await getOrCreateStripeCustomer(userId)

  // Attach the payment method to the customer before creating the subscription
  await stripe.paymentMethods.attach(paymentMethodId, {
    customer: customer.stripeCustomerId,
  })

  // Set as the default payment method for invoices
  await stripe.customers.update(customer.stripeCustomerId, {
    invoice_settings: { default_payment_method: paymentMethodId },
  })

  const subscription = await stripe.subscriptions.create({
    customer: customer.stripeCustomerId,
    items: [{ price: process.env.STRIPE_PRICE_ID_MONTHLY }],
    default_payment_method: paymentMethodId,
    expand: ['latest_invoice'],
  })

  // Update DB immediately — webhook will idempotently confirm later
  await updateUserStripeSubscription(
    userId,
    customer.stripeCustomerId,
    subscription.id,
    true
  )

  return ApiResponse.OK({ subscriptionId: subscription.id })
})
```

**Important edge case:** If `subscription.status` is not `'active'` (e.g., `'incomplete'` due to a 3DS challenge), do NOT mark `isPro = true` yet. The webhook `invoice.payment_succeeded` is the authoritative signal for activation in that case.

```ts
// Revised DB update in the subscribe route:
const isActive = subscription.status === 'active'
if (isActive) {
  await updateUserStripeSubscription(userId, customer.stripeCustomerId, subscription.id, true)
}

return ApiResponse.OK({ subscriptionId: subscription.id, status: subscription.status })
```

---

## 6. New DB Helper: `getOrCreateStripeCustomer`

**File:** `src/lib/db/stripe.ts` — add this function:

```ts
import { prisma } from '@/lib/prisma'
import { stripe } from '@/lib/stripe'  // import server-side stripe instance
import { getUserById } from '@/lib/db/users'

export async function getOrCreateStripeCustomer(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { stripeCustomerId: true, email: true, name: true },
  })

  if (!user) throw new Error(`User ${userId} not found`)

  if (user.stripeCustomerId) {
    return { stripeCustomerId: user.stripeCustomerId }
  }

  // Create a new Stripe Customer and persist the ID
  const customer = await stripe.customers.create({
    email: user.email ?? undefined,
    name: user.name ?? undefined,
    metadata: { userId },  // link back to internal ID
  })

  await prisma.user.update({
    where: { id: userId },
    data: { stripeCustomerId: customer.id },
  })

  return { stripeCustomerId: customer.id }
}
```

**Note:** This helper is only called from API routes, not Server Actions — the Stripe Node SDK should stay server-side only.

---

## 7. Client Components

### 7a. Checkout Modal

**File:** `src/app/(app)/settings/_components/checkout-modal.tsx`

A `Dialog` that holds the `<Elements>` provider and the payment form. The `clientSecret` is fetched on demand when the modal opens.

```tsx
'use client'

import { useState, useEffect } from 'react'
import { Elements } from '@stripe/react-stripe-js'
import { stripePromise } from '@/lib/stripe-client'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { apiFetch } from '@/lib/api-fetch'
import { PaymentForm } from './payment-form'
import { getStripeAppearance } from '@/lib/stripe-appearance'

interface CheckoutModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function CheckoutModal({ open, onOpenChange, onSuccess }: CheckoutModalProps) {
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return

    setClientSecret(null)
    setLoadError(null)

    apiFetch<{ clientSecret: string }>('/api/stripe/setup-intent', { method: 'POST' })
      .then((res) => {
        if (res.status === 'ok' && res.data?.clientSecret) {
          setClientSecret(res.data.clientSecret)
        } else {
          setLoadError(res.message ?? 'Failed to initialize checkout.')
        }
      })
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upgrade to DevStash Pro</DialogTitle>
          <DialogDescription>
            Unlimited items, collections, and file uploads.
          </DialogDescription>
        </DialogHeader>

        {loadError && (
          <p className="text-sm text-destructive">{loadError}</p>
        )}

        {clientSecret ? (
          <Elements
            stripe={stripePromise}
            options={{
              clientSecret,
              appearance: getStripeAppearance(),
            }}
          >
            <PaymentForm onSuccess={onSuccess} onCancel={() => onOpenChange(false)} />
          </Elements>
        ) : !loadError ? (
          <div className="flex justify-center py-8">
            {/* Skeleton or spinner while SetupIntent loads */}
            <div className="h-32 w-full animate-pulse rounded-md bg-muted" />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
```

### 7b. Payment Form

**File:** `src/app/(app)/settings/_components/payment-form.tsx`

The inner form rendered inside the `<Elements>` boundary. Handles submission, errors, and the subscribe call.

```tsx
'use client'

import { useState } from 'react'
import { useStripe, useElements, PaymentElement } from '@stripe/react-stripe-js'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api-fetch'
import { toast } from 'sonner'

interface PaymentFormProps {
  onSuccess: () => void
  onCancel: () => void
}

export function PaymentForm({ onSuccess, onCancel }: PaymentFormProps) {
  const stripe = useStripe()
  const elements = useElements()
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return

    setIsLoading(true)
    setErrorMessage(null)

    // Step 1: Validate the PaymentElement fields
    const { error: submitError } = await elements.submit()
    if (submitError) {
      setErrorMessage(submitError.message ?? 'Invalid payment details.')
      setIsLoading(false)
      return
    }

    // Step 2: Confirm the SetupIntent (saves the payment method)
    // redirect: 'if_required' means cards stay in-app — only redirect-based methods redirect
    const { error, setupIntent } = await stripe.confirmSetup({
      elements,
      redirect: 'if_required',
      confirmParams: {
        return_url: `${window.location.origin}/settings?setup_complete=true`,
      },
    })

    if (error) {
      setErrorMessage(error.message ?? 'Payment authorization failed.')
      setIsLoading(false)
      return
    }

    if (!setupIntent || setupIntent.status !== 'succeeded') {
      // Redirect-based payment method — user will be redirected to return_url
      // The return_url handler (in BillingForms useEffect) will finalize the subscription
      setIsLoading(false)
      return
    }

    // Step 3: Create the subscription server-side
    const paymentMethodId = typeof setupIntent.payment_method === 'string'
      ? setupIntent.payment_method
      : setupIntent.payment_method?.id

    if (!paymentMethodId) {
      setErrorMessage('Payment method not found after setup.')
      setIsLoading(false)
      return
    }

    const result = await apiFetch<{ subscriptionId: string; status: string }>(
      '/api/stripe/subscribe',
      { method: 'POST', body: { paymentMethodId } }
    )

    setIsLoading(false)

    if (result.status === 'ok') {
      toast.success('Welcome to DevStash Pro!')
      onSuccess()
    } else {
      setErrorMessage(result.message ?? 'Failed to activate subscription.')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement
        options={{
          layout: 'tabs',
          fields: {
            billingDetails: {
              email: 'never',  // we pass it server-side from session
            },
          },
        }}
      />

      {errorMessage && (
        <p className="text-sm text-destructive">{errorMessage}</p>
      )}

      <div className="flex gap-2 justify-end">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isLoading}>
          Cancel
        </Button>
        <Button type="submit" disabled={!stripe || !elements || isLoading}>
          {isLoading ? 'Processing...' : 'Subscribe — $9/mo'}
        </Button>
      </div>
    </form>
  )
}
```

### 7c. Stripe Appearance Helper

**File:** `src/lib/stripe-appearance.ts`

Stripe's `appearance` API does not accept CSS variables — it needs resolved color values. This helper reads DevStash's design tokens at runtime.

```ts
import type { Appearance } from '@stripe/stripe-js'

export function getStripeAppearance(): Appearance {
  // Read resolved CSS custom properties at call time (client-only)
  const style = getComputedStyle(document.documentElement)
  const get = (v: string) => style.getPropertyValue(v).trim()

  // Fallback values match DevStash dark theme (oklch values approximated to hex for Stripe)
  return {
    theme: 'night',
    variables: {
      colorPrimary: get('--color-primary') || '#3b82f6',         // blue-500
      colorBackground: get('--color-card') || '#1a1a2e',
      colorText: get('--color-foreground') || '#f4f4f5',
      colorTextSecondary: get('--color-muted-foreground') || '#a1a1aa',
      colorDanger: get('--color-destructive') || '#ef4444',
      borderRadius: '8px',                                        // matches --radius: 0.625rem
      fontFamily: 'inherit',
      spacingUnit: '4px',
    },
    rules: {
      '.Input': {
        border: `1px solid ${get('--color-border') || '#3f3f46'}`,
        backgroundColor: get('--color-input') || '#27272a',
      },
      '.Input:focus': {
        borderColor: get('--color-primary') || '#3b82f6',
        boxShadow: 'none',
      },
      '.Label': {
        color: get('--color-foreground') || '#f4f4f5',
        fontSize: '0.875rem',
        fontWeight: '500',
      },
      '.Tab': {
        border: `1px solid ${get('--color-border') || '#3f3f46'}`,
        backgroundColor: 'transparent',
      },
      '.Tab--selected': {
        borderColor: get('--color-primary') || '#3b82f6',
      },
    },
  }
}
```

**Caveat:** `getComputedStyle` is client-only. `getStripeAppearance()` must only be called inside client components (e.g., `useEffect` or render-time of a `'use client'` component).

---

## 8. Modified Files

### 8a. `src/actions/stripe.ts`

Remove `createCheckoutSessionAction` (replaced by the `/api/stripe/setup-intent` + `/api/stripe/subscribe` routes). Keep `createPortalSessionAction` unchanged — the portal redirect pattern is still correct for managing existing subscriptions.

```ts
'use server'

// REMOVE: createCheckoutSessionAction
// KEEP: createPortalSessionAction (no changes)
```

### 8b. `src/app/(app)/settings/_components/billing-actions.tsx`

Replace the checkout `<form>` with the `<CheckoutModal>` trigger. The "Manage Subscription" form remains unchanged.

```tsx
'use client'

import { useState } from 'react'
import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { useRouter } from 'next/navigation'
import { useFormStatus } from 'react-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { createPortalSessionAction } from '@/actions/stripe'
import { CheckoutModal } from './checkout-modal'

// Keep ManageSubscriptionButton (useFormStatus requires being inside <form>)
function ManageSubscriptionButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="outline" disabled={pending} className="w-full sm:w-auto">
      {pending ? 'Redirecting...' : 'Manage Subscription'}
    </Button>
  )
}

interface BillingFormsProps {
  isPro: boolean
  priceId: string | null
}

export function BillingForms({ isPro, priceId }: BillingFormsProps) {
  const [modalOpen, setModalOpen] = useState(false)
  const searchParams = useSearchParams()
  const router = useRouter()

  useEffect(() => {
    const success = searchParams.get('success')
    const canceled = searchParams.get('canceled')
    const setupComplete = searchParams.get('setup_complete')

    if (success) {
      toast.success('Subscription successful! Welcome to DevStash Pro.')
    } else if (canceled) {
      toast.info('Checkout canceled. Your subscription has not been changed.')
    } else if (setupComplete) {
      // Redirect-based payment method returned — subscription may be pending webhook
      toast.info('Payment authorized. Your Pro access will activate shortly.')
    }

    if (success || canceled || setupComplete) {
      window.history.replaceState(null, '', '/settings')
    }
  }, [searchParams])

  function handleUpgradeSuccess() {
    setModalOpen(false)
    router.refresh()
  }

  if (isPro) {
    return (
      <form action={createPortalSessionAction}>
        <ManageSubscriptionButton />
      </form>
    )
  }

  if (!priceId) return null

  return (
    <>
      <Button onClick={() => setModalOpen(true)} className="w-full sm:w-auto">
        Upgrade to Pro
      </Button>
      <CheckoutModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        onSuccess={handleUpgradeSuccess}
      />
    </>
  )
}
```

### 8c. `src/app/api/webhooks/stripe/route.ts`

Add handlers for the new webhook events fired by the SetupIntent → Subscription flow. All existing handlers remain. New events to handle as idempotent safety nets:

```ts
case 'invoice.payment_succeeded': {
  const invoice = event.data.object as Stripe.Invoice
  const subscriptionId = typeof invoice.subscription === 'string'
    ? invoice.subscription
    : invoice.subscription?.id
  const customerId = typeof invoice.customer === 'string'
    ? invoice.customer
    : invoice.customer?.id

  if (!subscriptionId || !customerId) break

  // Idempotent — if subscribe route already set isPro=true, this is a no-op
  await updateUserStripeSubscriptionByCustomerId(customerId, subscriptionId, true)
  log.info(`invoice.payment_succeeded — activated subscription ${subscriptionId}`)
  break
}
```

This requires a new DB helper `updateUserStripeSubscriptionByCustomerId` in `src/lib/db/stripe.ts`:

```ts
export async function updateUserStripeSubscriptionByCustomerId(
  stripeCustomerId: string,
  stripeSubscriptionId: string,
  isPro: boolean
) {
  return prisma.user.updateMany({
    where: { stripeCustomerId },
    data: { isPro, stripeSubscriptionId },
  })
}
```

---

## 9. Redirect-Based Payment Methods (Edge Case)

Some payment methods (iDEAL, Bancontact, SEPA Direct Debit) require a browser redirect even with `redirect: 'if_required'`. In these cases:

1. `stripe.confirmSetup()` redirects to the payment provider
2. Provider redirects back to `return_url` (`/settings?setup_complete=true`)
3. The `setup_complete` param is detected in `BillingForms` `useEffect` → shows info toast
4. Stripe fires `setup_intent.succeeded` webhook
5. Webhook handler creates the subscription and updates the DB

**Webhook handler for this path:**

```ts
case 'setup_intent.succeeded': {
  const setupIntent = event.data.object as Stripe.SetupIntent
  const customerId = typeof setupIntent.customer === 'string'
    ? setupIntent.customer : setupIntent.customer?.id
  const paymentMethodId = typeof setupIntent.payment_method === 'string'
    ? setupIntent.payment_method : setupIntent.payment_method?.id

  if (!customerId || !paymentMethodId) break

  // Find the user by stripeCustomerId
  const user = await prisma.user.findFirst({ where: { stripeCustomerId: customerId } })
  if (!user || user.isPro) break  // already activated — skip

  // Create subscription (idempotent check: user.stripeSubscriptionId is null)
  const subscription = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: process.env.STRIPE_PRICE_ID_MONTHLY }],
    default_payment_method: paymentMethodId,
  })

  await updateUserStripeSubscription(user.id, customerId, subscription.id, true)
  log.info(`setup_intent.succeeded — created subscription for user ${user.id}`)
  break
}
```

---

## 10. Handling the Happy Path vs. Incomplete Subscriptions

When a subscription is created, `subscription.status` may not immediately be `'active'`:

| Status | Cause | What to do |
|---|---|---|
| `'active'` | Card charged successfully | Mark `isPro = true` immediately |
| `'incomplete'` | 3DS challenge required | Show "complete authentication" flow; wait for `invoice.payment_succeeded` webhook |
| `'past_due'` | Retry in progress | Don't mark Pro yet; wait for webhook |
| `'canceled'` | Payment failed all retries | Don't mark Pro |

The subscribe API route should only set `isPro = true` when `subscription.status === 'active'`. For all other statuses, return the status to the client and let the webhook handle activation.

---

## 11. File Structure Summary

```
src/
├── lib/
│   ├── stripe.ts                          (existing — server SDK)
│   ├── stripe-client.ts                   (NEW — loadStripe singleton)
│   ├── stripe-appearance.ts               (NEW — appearance helper)
│   └── db/
│       └── stripe.ts                      (MODIFIED — add getOrCreateStripeCustomer,
│                                                       updateUserStripeSubscriptionByCustomerId)
├── app/
│   └── api/
│       ├── stripe/
│       │   ├── setup-intent/
│       │   │   └── route.ts               (NEW — POST creates SetupIntent)
│       │   └── subscribe/
│       │       └── route.ts               (NEW — POST creates Subscription)
│       └── webhooks/
│           └── stripe/
│               └── route.ts              (MODIFIED — add invoice.payment_succeeded,
│                                                       setup_intent.succeeded handlers)
│   └── (app)/
│       └── settings/
│           └── _components/
│               ├── billing-settings.tsx   (unchanged)
│               ├── billing-actions.tsx    (MODIFIED — modal trigger replaces form)
│               ├── checkout-modal.tsx     (NEW — Dialog + Elements wrapper)
│               └── payment-form.tsx       (NEW — PaymentElement + submit logic)
└── actions/
    └── stripe.ts                          (MODIFIED — remove createCheckoutSessionAction)
```

---

## 12. Testing Strategy

### Unit Tests (`src/app/api/stripe/setup-intent/route.test.ts`, `subscribe/route.test.ts`)

- Returns `bad_request` when `paymentMethodId` is missing from subscribe body
- Returns `unauthorized` when session is missing
- Calls `getOrCreateStripeCustomer` and `stripe.subscriptions.create` with correct args
- Sets `isPro = true` when subscription status is `'active'`
- Does NOT set `isPro = true` when subscription status is `'incomplete'`
- Webhook: `invoice.payment_succeeded` activates user idempotently
- Webhook: `setup_intent.succeeded` creates subscription for redirect-based payment methods

### Manual Checklist

```bash
# Terminal 1
npm run dev

# Terminal 2 — copy webhook secret to .env
stripe listen --forward-to localhost:3000/api/webhooks/stripe

# Terminal 3 — test event triggers
stripe trigger setup_intent.succeeded
stripe trigger invoice.payment_succeeded
stripe trigger customer.subscription.deleted
```

**Test cards:**

| Card | Scenario |
|---|---|
| `4242 4242 4242 4242` | Success — `subscription.status === 'active'` |
| `4000 0025 0000 3155` | 3DS required — `subscription.status === 'incomplete'`, then webhook activates |
| `4000 0000 0000 9995` | Card declined — error shown in PaymentElement |
| `4000 0000 0000 0077` | Charge succeeds but subscription goes `past_due` |

**Golden paths to verify:**
1. Free user upgrades with card → stays in app → isPro = true on refresh
2. Free user upgrades with iDEAL → redirected → returns to `/settings?setup_complete=true` → toast → isPro = true after webhook
3. Pro user manages subscription → portal redirect (unchanged from Phase 2)
4. Subscription canceled via portal → `customer.subscription.deleted` webhook → isPro = false
5. 3DS challenge → complete in popup → subscription activates via webhook
6. Declined card → error shown inline in PaymentElement — no toast spam

---

## 13. What Changes From Phase 2

| Item | Phase 2 | Phase 3 |
|---|---|---|
| `createCheckoutSessionAction` | Used | **Removed** |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Not used | **Required** |
| `STRIPE_PUBLISHABLE_KEY` | Declared (unused) | **Removed** |
| Upgrade UX | Redirect to Stripe | Modal stays in app |
| `BillingForms` | `<form>` with Server Action | Button opens `<CheckoutModal>` |
| New API routes | None | `/api/stripe/setup-intent`, `/api/stripe/subscribe` |
| Webhook events handled | `checkout.session.completed`, `customer.subscription.deleted` | + `invoice.payment_succeeded`, `setup_intent.succeeded` |
| `createPortalSessionAction` | Used | **Unchanged** |
