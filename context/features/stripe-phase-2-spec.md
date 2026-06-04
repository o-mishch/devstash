# Stripe Integration - Phase 2: Webhooks, Checkout & UI Integration

## 1. Overview & Architecture
Phase 2 connects DevStash to Stripe's payment infrastructure. It involves creating Checkout Sessions for upgrades, Customer Portals for managing subscriptions, and most importantly, Webhooks to securely and asynchronously update the DevStash database when subscription states change.

**Design Philosophy:**
- **Webhooks are Mandatory:** Never rely on the `success_url` redirect of a Checkout Session to update your database. Users can close the browser before the redirect finishes. Only trust Stripe Webhooks.
- **Raw Body Parsing:** Stripe Webhook signatures rely on the exact raw byte stream of the request.
- **Server Actions over API Routes (Where Possible):** Use Server Actions for Checkout and Portal redirects to simplify Next.js routing, keeping API Routes strictly for the Webhook listener.

---

## 2. Configuration & Environment Variables

Define the following in `.env.local` (and add to deployment platform, e.g., Vercel):
```env
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID_MONTHLY=price_123...
STRIPE_PRICE_ID_YEARLY=price_456...
NEXT_PUBLIC_APP_URL=http://localhost:3000 # Required for Stripe success/cancel URLs
```

---

## 3. Stripe Checkout & Portal Sessions (Server Actions)

Instead of building App Router API endpoints (`/api/stripe/checkout`), we will use Next.js Server Actions to redirect the user. This is cleaner and more idiomatic in Next.js 14/15/16.

**File: `src/actions/stripe.ts`**
```typescript
"use server";

import { auth } from "@/auth";
import { stripe } from "@/lib/stripe";
import { redirect } from "next/navigation";
import prisma from "@/lib/db/prisma";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export async function createCheckoutSessionAction(priceId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  // 🟢 Best Practice: Pass the internal User ID as client_reference_id
  // This is crucial for linking the webhook event back to our DB.
  const stripeSession = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${APP_URL}/settings?success=true`,
    cancel_url: `${APP_URL}/settings?canceled=true`,
    client_reference_id: session.user.id,
    customer_email: session.user.email ?? undefined,
  });

  redirect(stripeSession.url!);
}

export async function createPortalSessionAction() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user?.stripeCustomerId) throw new Error("No Stripe Customer ID found");

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${APP_URL}/settings`,
  });

  redirect(portalSession.url);
}
```

---

## 4. Webhook Implementation (The Critical Component)

Webhooks must use standard Next.js App Router API Routes.

**🔴 Anti-Pattern (DO NOT DO THIS):**
```typescript
export async function POST(req: Request) {
  const body = await req.json(); // FATAL ERROR: This parses the body to an object, destroying the original string required for signature verification.
  // ...
}
```

**🟢 Best Practice:**
Extract the raw text body using `req.text()`.

**File: `src/app/api/webhooks/stripe/route.ts`**
```typescript
import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import prisma from "@/lib/db/prisma";

export async function POST(req: NextRequest) {
  const body = await req.text(); // MUST BE RAW TEXT
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "No signature found" }, { status: 400 });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error(`Webhook signature verification failed.`, err.message);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        // Retrieve the client_reference_id we passed in the Checkout creation
        const userId = session.client_reference_id;
        if (!userId) throw new Error("No client_reference_id in session");

        await prisma.user.update({
          where: { id: userId },
          data: {
            isPro: true,
            stripeCustomerId: session.customer as string,
            stripeSubscriptionId: session.subscription as string,
          },
        });
        break;
      }
      
      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        await prisma.user.updateMany({
          where: { stripeSubscriptionId: subscription.id },
          data: {
            isPro: false,
            stripeSubscriptionId: null, // Clear it so they can resubscribe cleanly
          },
        });
        break;
      }
      
      // Optionally handle invoice.payment_failed
    }
  } catch (error) {
    console.error("Webhook handler error:", error);
    // Return 500 to force Stripe to retry
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }

  // 🟢 Best Practice: Return a 200 OK quickly to acknowledge receipt
  return NextResponse.json({ received: true });
}
```

---

## 5. Billing Settings UI

Create a Server Component to display billing status securely.

**File: `src/components/settings/billing-settings.tsx`**
- Server Component: Fetch `getUserUsage(session.user.id)` directly (no API calls).
- **Client-Side Interaction & Feedback (Best Practices):**
  - **Loading States:** Creating a Stripe Checkout or Portal session takes 1-3 seconds. Wrap the submit buttons in a Client Component that uses `useFormStatus` (or similar state) to show a loading spinner and disable the button while `pending === true`. This prevents double-clicks and provides immediate feedback.
  - **Redirect Notifications (Toasts):** When Stripe redirects the user back to the application, it includes URL parameters (`?success=true` or `?canceled=true` based on the URLs configured in the server action). Use a client-side hook (e.g., `useEffect` with `useSearchParams`) to detect these and trigger a toast notification.
    - `success=true` ➡️ Show success toast: *"Subscription successful! Welcome to DevStash Pro."*
    - `canceled=true` ➡️ Show info toast: *"Checkout canceled. Your subscription has not been changed."*
    - *Crucial:* Clean up the URL (using `window.history.replaceState`) immediately after showing the toast so it doesn't reappear if the user refreshes the page.
- If `isPro` is false:
  - Render Progress Bars using standard Tailwind UI.
  - Render Client Components containing forms that invoke the Server Actions:
    ```tsx
    // Example: Client-side submit button with loading feedback
    "use client";
    import { useFormStatus } from "react-dom";
    import { createCheckoutSessionAction } from "@/actions/stripe";

    function UpgradeButton({ priceId, label }: { priceId: string, label: string }) {
      const { pending } = useFormStatus();
      return (
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? "Redirecting to Stripe..." : label}
        </button>
      );
    }
    
    // Usage in parent:
    // <form action={createCheckoutSessionAction.bind(null, process.env.STRIPE_PRICE_ID_MONTHLY!)}>
    //   <UpgradeButton priceId="..." label="Upgrade to Pro (Monthly)" />
    // </form>
    ```
- If `isPro` is true:
  - Render a "Manage Subscription" button that invokes `createPortalSessionAction` with the exact same `useFormStatus` loading pattern.

---

## 6. Testing Strategy & Implementation Notes

### Essential Testing Workflow

To properly test webhooks locally, you must run multiple terminal sessions simultaneously.

```bash
# Terminal 1: Run dev server
npm run dev

# Terminal 2: Forward webhooks (copy the secret it outputs to .env.local)
stripe listen --forward-to localhost:3000/api/webhooks/stripe

# Terminal 3: Trigger test events to simulate Stripe backend activity
stripe trigger checkout.session.completed
stripe trigger invoice.paid
stripe trigger customer.subscription.deleted
```

- **Card Testing:** Use Stripe's standard test cards during a manual checkout flow to validate the UX (toast notifications, loading states):
  - `4242 4242 4242 4242` ➡️ **Successful payment**
  - `4000 0000 0000 0002` ➡️ **Card declined** (test graceful failure)
  - `4000 0000 0000 3220` ➡️ **3D Secure required** (test authentication flow)

### Stripe Sandbox & Dashboard Interactions

- **Product Configuration:** Ensure the "Test Mode" toggle is ON in the top right of the Stripe Dashboard. Navigate to the Product Catalog to create "DevStash Pro" and add its recurring prices. Copy the `price_...` IDs into `.env.local`.
- **Simulating Cancellations:** To manually test the downgrade flow without writing code, find the test Customer in the Stripe Dashboard, click their active subscription, and select "Cancel Subscription" (Immediate). This fires the `customer.subscription.deleted` webhook to your local server.
- **Debugging Webhooks:** If local webhooks fail, open the Stripe Dashboard ➡️ Developers ➡️ Webhooks. Click into your local CLI endpoint to view the exact JSON payload Stripe sent and the specific HTTP status/error your Next.js server returned.

### Core Scenarios to Validate
- **Feature Gating:** Verify Free Tier constraints are enforced strictly on both the UI and Server Actions (limits: 50 items, 3 collections, no file uploads).
- **Pro Bypass:** Confirm Pro users have unbounded access.
- **State Synchronization:** Ensure that once a webhook updates the DB, a simple page reload reflects the Pro status (via the `jwt` DB-sync callback).
- **Downgrade Path:** Ensure a subscription deletion cleanly removes Pro status without corrupting the user's data.

### Critical Developer Notes
- **Webhook Parsing:** `request.text()` is strictly required for webhook routes in the App Router to maintain signature integrity.
- **Idempotency:** Webhook database operations must be idempotent (e.g., using `updateMany`). Stripe may deliver the same event multiple times.
- **Graceful Failures:** Do not immediately downgrade a user on an `invoice.payment_failed` event; Stripe will handle retries. Only downgrade upon `customer.subscription.deleted`.
- **Scope:** The public `PricingSection.tsx` on the homepage remains unchanged in this phase (the existing CTA to `/register` is sufficient for now).
- **Type Safety:** Always run a final `npm run build` to ensure the extended NextAuth `Session` and `JWT` types do not cause production build failures.
