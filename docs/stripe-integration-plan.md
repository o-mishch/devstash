# DevStash Pro: Stripe Integration Plan

## 1. Current State Analysis

- **User Model Schema**: The `User` model in `prisma/schema.prisma` already includes `isPro` (Boolean, default `false`), `stripeCustomerId` (String, unique), and `stripeSubscriptionId` (String, unique).
- **NextAuth Configuration**: The session currently uses the JWT strategy (`src/auth.ts`). However, the `isPro` property is not yet injected into the NextAuth `Session` or `JWT` types, nor is it synced during the `jwt` callback.
- **Server Actions**: `src/actions/items.ts` and `src/actions/collections.ts` currently allow creation without checking any usage limits or the user's `isPro` status.
- **API Routes**: Upload API routes do not yet enforce Pro-only restrictions.

## 2. Feature Gating Analysis

- **Free Tier Limits**:
  - Maximum 50 items.
  - Maximum 3 collections.
- **Pro-Only Features**:
  - File/Image uploads (`itemTypeName` is `file` or `image`).
  - Unlimited items and collections.
- **Settings Page**: A billing section needs to be added to `src/app/settings/page.tsx` to display usage statistics and offer upgrade options to the PLN 30/mo or PLN 270/year plans.

## 3. API & Webhook Patterns

- **API Route Structure**: Next.js App Router API routes will be used (`src/app/api/stripe/checkout/route.ts`, `src/app/api/stripe/portal/route.ts`, `src/app/api/webhooks/stripe/route.ts`). Webhooks require raw body access, which the App Router provides natively via `request.text()`.
- **Server Action Error Handling**: We use the standard `ActionState` structure (e.g., `{ success: false, message: '...' }`) for returning errors from server actions.
- **Environment Variables**: Server-side env vars mapping to Stripe Price IDs must be used (`STRIPE_PRICE_ID_MONTHLY`, `STRIPE_PRICE_ID_YEARLY`), alongside standard Stripe keys (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`).

## 4. Implementation Plan

### Files to Create

1. **`src/lib/stripe.ts`**:
   - Initialize Stripe SDK using `STRIPE_SECRET_KEY`.
2. **`src/lib/usage.ts`**:
   - Utility functions `getUserUsage`, `canCreateItem`, `canCreateCollection` to check limits (50 items / 3 collections) unless `isPro` is true.
3. **`src/app/api/stripe/checkout/route.ts`**:
   - API route to create a Stripe Checkout Session for DevStash Pro (using PLN 30/mo or PLN 270/year price IDs).
4. **`src/app/api/stripe/portal/route.ts`**:
   - API route to create a Stripe Billing Portal session for existing customers.
5. **`src/app/api/webhooks/stripe/route.ts`**:
   - Webhook handler for `checkout.session.completed`, `invoice.paid`, `customer.subscription.updated`, and `customer.subscription.deleted`.
6. **`src/components/settings/billing-settings.tsx`**:
   - Client component for displaying usage and upgrade/manage buttons.

### Files to Modify

1. **`src/types/next-auth.d.ts`**:
   - Extend NextAuth `Session` and `JWT` interfaces to include `isPro: boolean`.
2. **`src/auth.ts`**:
   - **Crucial Session Sync Fix**: Instead of relying on `trigger === "update"`, modify the `jwt` callback to query the database directly for `isPro` on every validation:
     ```typescript
     // Inside jwt callback:
     if (token.id) {
       const dbUser = await prisma.user.findUnique({
         where: { id: token.id as string },
         select: { isPro: true },
       });
       token.isPro = dbUser?.isPro ?? false;
     }
     ```
   - Pass `token.isPro` to `session.user.isPro` in the `session` callback.
3. **`src/actions/items.ts`**:
   - In `createItemAction`, return an error if `itemTypeName` is `file`/`image` and user is not Pro.
   - Return an error if `canCreateItem()` returns false.
4. **`src/actions/collections.ts`**:
   - In `createCollectionAction`, return an error if `canCreateCollection()` returns false.
5. **`src/app/api/upload/route.ts`**:
   - Fetch the user from the database and block uploads if `!isPro`.
6. **`src/app/settings/page.tsx`**:
   - Add the `<BillingSettings>` component and fetch usage stats using `getUserUsage`.

### Stripe Dashboard Setup Steps

1. Create a Product: "DevStash Pro".
2. Add a monthly price: PLN 30.
3. Add a yearly price: PLN 270.
4. Obtain the `price_...` IDs for both and set them in `.env` as `STRIPE_PRICE_ID_MONTHLY` and `STRIPE_PRICE_ID_YEARLY`.
5. Obtain the API secret key and publishable key (`STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`).
6. Configure a webhook endpoint pointing to your production URL (`/api/webhooks/stripe`) or use the Stripe CLI for local testing.
7. Set the webhook signing secret in `.env` (`STRIPE_WEBHOOK_SECRET`).

### Testing Checklist

- [ ] Check usage limits: create 50 items and verify the 51st is blocked.
- [ ] Check collection limits: create 3 collections and verify the 4th is blocked.
- [ ] Attempt file upload on free tier and verify it is blocked.
- [ ] Click "Upgrade" and complete Stripe Checkout with test card (e.g., `4242...`).
- [ ] Verify `isPro`, `stripeCustomerId`, and `stripeSubscriptionId` are updated in the database via the `checkout.session.completed` webhook.
- [ ] Reload page and verify NextAuth session instantly reflects `isPro: true` via the DB-sync callback workaround.
- [ ] Test the "Manage Billing" portal redirects correctly for Pro users.
- [ ] Test webhook for `customer.subscription.deleted` successfully downgrades the user.

### Implementation Order

1. Setup Stripe SDK (`stripe.ts`) and environment variables.
2. Implement usage tracking utilities (`usage.ts`).
3. Update NextAuth types and callbacks (`auth.ts`, `next-auth.d.ts`).
4. Implement API routes for Checkout and Customer Portal.
5. Apply feature gating to Server Actions (`items.ts`, `collections.ts`) and Upload route (`upload/route.ts`).
6. Build Billing UI on the Settings page.
7. Implement Webhook handler and test thoroughly with Stripe CLI.
