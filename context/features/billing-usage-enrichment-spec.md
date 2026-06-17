# Feature: Billing & Usage Enrichment

## Status
Planned

## Goal

Enrich the **Billing & Usage** card (`/settings`) for Pro users with additional billing
context sourced live from Stripe — **payment method**, **billing name**, and **invoice
history** — following Stripe + privacy best practices. Today the card shows only Plan, Pro
since, and Next renewal (all webhook-synced from the local DB).

The enrichment is **opt-in**: the card shows a **"Fetch details"** button; on click we fetch
the extra fields live from Stripe and **animate them into the existing card**. The data is
*not* stored locally and must not be — Stripe stays the system of record, and because the
fetch only fires on explicit user action, no personal data leaves Stripe until the user asks
for it (strongest GDPR data-minimisation posture).

Field availability verified via Context7 against `stripe@22.2.1` / API `2026-05-27.dahlia`
(the `dahlia` series).

## Scope (what gets added)

A **"Fetch details"** trigger inside the existing `BillingProPlanCard` (shown only when
`isPro && !billingUnavailable && canManageBilling`). On click it lazily fetches and then
animates in three new read-only sections appended to the same card:

1. **Payment method** — `Visa •••• 4242 · exp 12/27`, with a wallet badge (Apple Pay /
   Google Pay) when `card.wallet` is set. Source = the card that actually pays for *this*
   subscription, in precedence order (Context7-verified): `subscription.default_payment_method`
   → `customer.invoice_settings.default_payment_method`. (Stripe's recommended call for listing
   *all* saved cards is `paymentMethods.list({ customer, type: 'card' })`, but for a single
   "card on file" row we want the default PM, not the full list.)
2. **Billed to** — the cardholder / legal name (one line). Source order:
   `customer.individual_name` → `customer.business_name` → `default_payment_method.billing_details.name`.
   Omit the row entirely if none resolve.
3. **Billing history** — the latest **3** paid invoices: date, amount (formatted with
   currency), and a link to `hosted_invoice_url` (+ `invoice_pdf`). "View all" defers to the
   existing Stripe Billing Portal (`Manage Billing` button) — we do not build our own list page.

Trigger states: idle (`Fetch details` button) → loading (spinner, disabled) → loaded
(button is replaced by the revealed sections; no re-fetch unless the cache is invalidated) →
error (inline retry hint, sections stay hidden). Everything is **display-only**. No new
mutations. The existing `Manage Billing` / `Cancel Subscription` actions in
`billing-actions.tsx` are unchanged and remain the only way to *edit* the payment method
(Stripe-hosted portal — keeps us out of PCI scope).

## Privacy & PCI constraints (non-negotiable)

- **Never persist** any of these fields to Postgres. Fetch live, render, discard. The
  `users` table / `UserBillingState` shape stays as-is.
- **Never store or request** PAN, CVC, or full card data — Stripe does not return them and
  we never ask. We only read `card.brand` / `last4` / `exp_month` / `exp_year` / `wallet`.
- Lawful basis = performance of the subscription contract; data-minimisation applies — only
  pull what these three sections render.
- Stripe remains a sub-processor under the existing DPA; no privacy-policy change needed
  since nothing new is stored.

## Architecture

### Do NOT touch the DB-only cached path
`loadBillingPageContext` / `loadBillingDisplayContext` use `cacheLife('max')` and make **no
live Stripe call** by design. The new live data must NOT be added to that function or its
cache — doing so would either stale-pin live payment data for `max` or force a Stripe call
on every settings render.

### New live fetch — server-only, behind an authed route handler
- New server-only helper module `src/lib/billing/profile/billing-payment-profile.ts`:
  - `getBillingPaymentProfile(customerId: string): Promise<BillingPaymentProfile | null>`
    — retrieves the customer (expand `invoice_settings.default_payment_method`) + lists the
    latest 3 invoices, maps to a flat, browser-safe display shape, returns `null` on any
    Stripe error.
  - Wrap in `'use cache'` with `cacheTag(CacheTags.billingPaymentProfile(customerId))` and a
    **short** `cacheLife({ stale: 60, revalidate: 300, expire: 600 })` — so repeated button
    presses (or a re-mount) don't hammer Stripe; payment-method/invoice changes are rare and
    the Billing Portal is the source of edits.
  - Add `CacheTags.billingPaymentProfile(customerId)` to `src/lib/infra/cache.ts`, and bust
    it from the same webhook handlers that already revalidate billing (e.g.
    `payment_method.*`, `invoice.paid`, `customer.updated`) — extend the existing
    revalidation in the webhook event handlers; do not add a new webhook.
- New low-level Stripe calls in `src/lib/billing/stripe-api.ts` (mirroring the existing
  `retrieveStripeCustomer` / `retrieveStripeInvoice` style, each returning `null`/`[]` on
  error with a `log.warn`):
  - `retrieveCustomerWithDefaultPaymentMethod(customerId)` →
    `stripe.customers.retrieve(customerId, { expand: ['invoice_settings.default_payment_method'] })`.
    The mapper prefers the **subscription's** `default_payment_method` (already retrievable via
    the existing `fetchSubscriptionDetails`/expand path) and falls back to this customer-level
    default — both expanded so we read `card.*` without a second round-trip.
  - `listRecentInvoices(customerId, limit = 3)` →
    `stripe.invoices.list({ customer: customerId, limit, status: 'paid' })`.

### On-demand fetch — route handler, not Suspense
The client button cannot import server-only billing code, so the fetch goes through the
typed route-handler client (per `nextjs-architecture.md`: client reads/mutations use
`api`/`$api`, never Server Actions, never raw `fetch`):
- **New endpoint** `GET /api/billing/payment-profile`:
  - Handler `src/app/api/billing/payment-profile/route.ts` using `authedRoute` from
    `@/lib/api/route`. **`customerId` is resolved server-side from the session `userId`'s
    `stripeCustomerId`** (IDOR-safe) — never accepted from the client.
  - Returns `200` + `BillingPaymentProfile`, or `204`/empty when the user has no
    `stripeCustomerId` or Stripe errored (the UI treats both as "nothing to show").
  - Response schema in `src/lib/api/schemas/billing.ts`, declared in
    `src/lib/api/openapi/paths.ts`, then `npm run openapi:gen` to regenerate the client types
    (do not hand-edit generated types).
- **Client hook** `useBillingPaymentProfile()` in `src/hooks/use-billing-payment-profile.ts`
  wrapping `$api.useQuery('get', '/api/billing/payment-profile', …, { enabled })` with
  `enabled` starting `false`; the hook exposes `{ fetchDetails, data, isFetching, isError }`.
  Lazy by design — no request until the button sets `enabled = true`. Keeps `useQueryClient`
  out of the component per coding standards.

### Display shape (browser-safe, no `Stripe.*` types leaking to client)
```ts
// src/lib/billing/profile/billing-payment-profile.ts  [S]
export interface BillingCardSummary {
  brand: string            // 'visa'
  last4: string            // '4242'
  expMonth: number
  expYear: number
  wallet: string | null    // 'apple_pay' | 'google_pay' | null
}
export interface BillingInvoiceSummary {
  id: string
  number: string | null
  created: Date
  amountPaid: number       // minor units
  currency: string         // 'pln'
  hostedInvoiceUrl: string | null
  invoicePdf: string | null
}
export interface BillingPaymentProfile {
  billedToName: string | null
  card: BillingCardSummary | null
  invoices: BillingInvoiceSummary[]
}
```

### Back-end cache (avoid re-fetching from Stripe)
The live data is cached **server-side**, keyed by `customerId`, so repeated button presses,
a page revisit, or a second device do **not** trigger a new Stripe call within the TTL:
- The `'use cache'` wrapper on `getBillingPaymentProfile` is the single cache boundary
  (`cacheTag(CacheTags.billingPaymentProfile(customerId))`,
  `cacheLife({ stale: 60, revalidate: 300, expire: 600 })`). Within `stale`/`revalidate` the
  route handler returns the cached profile with no Stripe round-trip; after `revalidate` it
  serves stale and refreshes in the background; after `expire` the next call re-fetches.
  This is the Context7-verified pattern (`'use cache'` + `cacheLife` + `cacheTag`, busted via
  `revalidateTag`) and matches the existing convention in `user-billing-state.ts`.
- **Cross-instance caveat (Context7):** plain `'use cache'` is only guaranteed shared across
  serverless instances when a remote cache handler is configured; otherwise each Vercel
  instance keeps its own copy. Next.js documents **`'use cache: remote'`** specifically for
  caching *external API responses* so they're shared deployment-wide. **Decision:** start with
  plain `'use cache'` to match the rest of the billing code (a same-instance/per-customer
  cache already removes the repeat-press problem); if production shows redundant Stripe calls
  across instances, promote this one function to `'use cache: remote'` — it's a one-line
  change, no other code moves. The webhook tag-bust keeps either variant correct when the
  card/invoice actually changes.
- TanStack Query on the client adds a *second* short-lived layer (its default `staleTime`),
  so an already-fetched profile re-shows instantly on toggle without even hitting the route
  handler. The server `'use cache'` TTL is the authoritative Stripe-rate-limit guard; the
  client cache is only a UX nicety.

### Rendering — animate the reveal into the existing card
- `BillingProPlanCard` becomes (or wraps) a small `'use client'` island that owns the
  reveal: an idle **"Fetch details"** `Button` (ghost/secondary) appended after the existing
  rows. On click → `fetchDetails()` from the hook; while `isFetching`, the button shows a
  spinner and is disabled; on success the button is replaced by the three sections.
- **Animation (CSS, no framer-motion — matches the project's CSS-transform approach):** wrap
  the revealed block in a container that transitions `grid-template-rows: 0fr → 1fr` (height
  auto without magic numbers) plus `opacity 0 → 1` and a slight `translate-y`, staggering the
  three rows by ~60ms. Gate all of it behind `motion-safe:` / honour
  `prefers-reduced-motion` (instant show when reduced). Reuse existing Tailwind transition
  utilities; add a tiny keyframe in `globals.css` only if the stagger needs it.
- New presentational pieces in `billing-settings-sections.tsx` (or a sibling
  `billing-payment-profile-sections.tsx` if `sections.tsx` grows too large):
  `PaymentMethodRow`, `BilledToRow`, `BillingInvoiceList`, and the client reveal island
  `BillingDetailsReveal` — all reusing `BillingDetailRow` and the existing card/divider
  styling. Add a small `formatCurrencyMinor(amount, currency)` helper in
  `src/lib/utils/format.ts` next to `formatDate` (Intl.NumberFormat, minor→major).

## Files to touch

- `src/lib/billing/stripe-api.ts` — add `retrieveCustomerWithDefaultPaymentMethod`,
  `listRecentInvoices` (+ exported result types).
- `src/lib/billing/profile/billing-payment-profile.ts` — **new**; mapping + `'use cache'`
  wrapper (short TTL) + display interfaces.
- `src/lib/infra/cache.ts` — add `billingPaymentProfile(customerId)` cache tag.
- `src/lib/billing/webhook/stripe-webhook-event-handlers.ts` — bust the new tag on
  `payment_method.*` / `invoice.paid` / `customer.updated` (extend existing revalidation).
- `src/lib/api/schemas/billing.ts` — add the `BillingPaymentProfile` response schema.
- `src/lib/api/openapi/paths.ts` — declare `GET /api/billing/payment-profile`; then
  `npm run openapi:gen`.
- `src/app/api/billing/payment-profile/route.ts` — **new**; `authedRoute`, resolves
  `customerId` from the session user, returns the profile or `204`.
- `src/hooks/use-billing-payment-profile.ts` — **new**; lazy `$api.useQuery` wrapper exposing
  `{ fetchDetails, data, isFetching, isError }`.
- `src/lib/utils/format.ts` — add `formatCurrencyMinor`.
- `src/components/billing/billing-settings-sections.tsx` (+ optional new sibling) —
  `PaymentMethodRow`, `BilledToRow`, `BillingInvoiceList`, and the `'use client'`
  `BillingDetailsReveal` island (button + animated reveal). `billing-settings.tsx` passes
  `customerId`/`canManageBilling` down; no `<Suspense>` needed.
- `src/app/globals.css` — only if a stagger keyframe is needed (prefer Tailwind utilities).

## Reuse

- `BillingDetailRow`, card/divider classes, `Badge` (wallet chip), `Separator`.
- `retrieveStripeCustomer` pattern (error→`null`), `fromStripeTs`, `logger.child({ tag })`.
- `CacheTags` + `cacheTag`/`cacheLife` conventions from `user-billing-state.ts`.
- `formatDate` from `src/lib/utils/format.ts`.

## Out of scope

- Editing/removing/adding payment methods in-app — stays in the Stripe Billing Portal.
- A dedicated invoices/billing-history page or pagination (portal covers "view all").
- Persisting any Stripe-sourced field to the DB or `UserBillingState`.
- Free-tier and `billingUnavailable` states — unchanged.
- Shipping address, tax IDs, phone — available from Stripe but not rendered (no feature need;
  data-minimisation). Note them here only as "available if a future invoice-detail view needs them."

## Verification

- `npm run lint` + `npm run openapi:gen` (new endpoint — regenerate + commit client types).
- **Vitest** (required — new utilities + route logic): `billing-payment-profile.test.ts`
  covering the Stripe→display mapping (card present/absent, wallet, name source precedence,
  invoice mapping, `null` on error); a route-handler test for `/api/billing/payment-profile`
  (no `stripeCustomerId` → `204`; customerId resolved from session, never from the request —
  IDOR check); and `format.test.ts` for `formatCurrencyMinor` (PLN/USD, zero-decimal
  currencies, minor→major). No component tests.
- Playwright at 1280px on `/settings` with a Pro test account: click **Fetch details**,
  confirm the loading state, then the payment-method row, billed-to, and 3 invoice links
  animate in; a second toggle re-shows instantly with no new network call (cache working).
  Close the browser when done.
- No `npm run build` unless lint/test leave a build-only risk.

## Open decisions (confirm before implementing)

1. Invoice count to show inline — default **3**; bump to 5?
2. Show **Billed to** name at all, or keep the card strictly payment-method + history to
   minimise personal data on screen?
3. If the default payment method is non-card (e.g. a future wallet/bank), render a generic
   "•••• {last4}" with the type label, or hide the row? Default: show type label, hide card
   brand fields.
