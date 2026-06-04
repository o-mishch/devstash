# Stripe Integration - Phase 1: Core Infrastructure & Usage Limits

## 1. Overview & Architecture
Phase 1 focuses on establishing a rock-solid, secure foundation for the Stripe integration. Instead of immediately jumping into UI and webhooks, we must first secure the backend. This phase covers Stripe SDK initialization, implementing deterministic usage tracking, modifying NextAuth for real-time state synchronization, and enforcing strict server-side feature gating.

**Design Philosophy:**
- **Zero Trust:** Never trust the client regarding subscription status.
- **Fail Closed:** If a limits check fails or errors out, assume the user cannot perform the action.
- **Database as Source of Truth (for App State):** While Stripe is the source of truth for billing, our local database is the source of truth for application access to ensure fast, synchronous authorization.

---

## 2. Stripe Initialization & Configuration

### Best Practices & Patterns
Initialize the Stripe SDK globally to prevent multiple instantiations across serverless functions.

**🟢 How to do it (Best Practice):**
Create a dedicated `src/lib/stripe.ts` file that exports a singleton instance of the Stripe SDK. Provide the API version explicitly to ensure breaking changes from Stripe do not affect the app unexpectedly. Provide `appInfo` for easier debugging in the Stripe dashboard.

```typescript
// src/lib/stripe.ts
import Stripe from "stripe";

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY is missing. Please set it in your .env file.");
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-04-10", // Always hardcode the exact API version you tested with
  appInfo: {
    name: "DevStash Pro",
    version: "0.1.0",
  },
  typescript: true,
});
```

**🔴 How NOT to do it (Anti-Pattern):**
Do not initialize Stripe directly inside individual API routes or server actions, as this creates new instances repeatedly, wasting memory and connections.
```typescript
// BAD
export async function POST() {
  const stripe = require('stripe')(process.env.STRIPE_SECRET); // Avoid this
}
```

---

## 3. Usage Limits Module

We need a robust module to check usage limits before performing mutations.

### Implementation Details
Create `src/lib/usage.ts`. We will define limits as constants at the top of the file.

```typescript
// src/lib/usage.ts
import prisma from "@/lib/db/prisma";

export const FREE_TIER_ITEM_LIMIT = 50;
export const FREE_TIER_COLLECTION_LIMIT = 3;

/**
 * Returns the current usage count for a user.
 */
export async function getUserUsage(userId: string) {
  const [itemsCount, collectionsCount] = await Promise.all([
    prisma.item.count({ where: { userId } }),
    prisma.collection.count({ where: { userId } }),
  ]);
  return { itemsCount, collectionsCount };
}

/**
 * Validates if the user is allowed to create a new item.
 */
export async function canCreateItem(userId: string, isPro: boolean): Promise<boolean> {
  if (isPro) return true;
  const count = await prisma.item.count({ where: { userId } });
  return count < FREE_TIER_ITEM_LIMIT;
}

/**
 * Validates if the user is allowed to create a new collection.
 */
export async function canCreateCollection(userId: string, isPro: boolean): Promise<boolean> {
  if (isPro) return true;
  const count = await prisma.collection.count({ where: { userId } });
  return count < FREE_TIER_COLLECTION_LIMIT;
}
```

### Testing Strategy (`src/lib/usage.test.ts`)
We use Vitest. The database *must* be mocked to prevent hitting a real DB during unit tests.

**🟢 How to test (Best Practice):**
```typescript
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { canCreateItem, FREE_TIER_ITEM_LIMIT } from './usage';
import prisma from './db/prisma';

vi.mock('./db/prisma', () => ({
  default: {
    item: { count: vi.fn() },
  },
}));

describe('Usage Limits', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('allows Pro users to create items without checking DB', async () => {
    const result = await canCreateItem('user_1', true);
    expect(result).toBe(true);
    expect(prisma.item.count).not.toHaveBeenCalled();
  });

  it('blocks free users over the limit', async () => {
    vi.mocked(prisma.item.count).mockResolvedValue(FREE_TIER_ITEM_LIMIT);
    const result = await canCreateItem('user_2', false);
    expect(result).toBe(false);
  });
});
```

---

## 4. NextAuth Session Real-Time Synchronization

By default, NextAuth JWTs become stale. If a user upgrades via a Stripe Webhook (which updates the database), their JWT session on the client still says `isPro: false` until they log out and log back in, or until a client-side session update is triggered.

### The "DB-Sync JWT" Pattern (Best Practice for NextAuth)

To fix this seamlessly, we query the DB inside the NextAuth `jwt` callback. Because the JWT callback runs on *every* authenticated request (including Server Actions and API routes), it instantly detects the DB change made by the webhook.

**File: `src/types/next-auth.d.ts`**
```typescript
import NextAuth, { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      isPro: boolean;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    isPro: boolean;
  }
}
```

**File: `src/auth.ts`**
```typescript
callbacks: {
  async jwt({ token, user }) {
    if (user) {
      token.id = user.id;
    }
    // 🟢 Best Practice: Always fetch current isPro status from DB to prevent stale JWTs
    if (token.id) {
      const dbUser = await prisma.user.findUnique({
        where: { id: token.id as string },
        select: { isPro: true },
      });
      token.isPro = dbUser?.isPro ?? false;
    }
    return token;
  },
  async session({ session, token }) {
    if (session.user) {
      session.user.id = token.id as string;
      session.user.isPro = token.isPro as boolean;
    }
    return session;
  }
}
```

**🔴 How NOT to do it (Anti-Pattern):**
Relying purely on `trigger === "update"` from the client side. This requires you to pass the state down to the client, listen for a webhook event (via polling or websockets), and manually call `update()`. It is brittle and prone to race conditions.

---

## 5. Server-Side Feature Gating

Now that `session.user.isPro` is perfectly synchronized, apply strict gating.

**File: `src/actions/items.ts`**
```typescript
import { auth } from "@/auth";
import { canCreateItem } from "@/lib/usage";
import { ApiBody, ApiResponse } from "@/types/api";

export async function createItemAction(data: any): Promise<ApiBody<any>> {
  const session = await auth();
  if (!session?.user?.id) return ApiResponse.UNAUTHORIZED();

  const isPro = session.user.isPro;

  // 1. Feature Gate: File/Image support
  if ((data.type === 'file' || data.type === 'image') && !isPro) {
    return ApiResponse.FORBIDDEN("Upgrade to Pro to upload files and images.");
  }

  // 2. Quantity Limit Gate
  const canCreate = await canCreateItem(session.user.id, isPro);
  if (!canCreate) {
    return ApiResponse.FORBIDDEN("You have reached your free tier limit of 50 items. Please upgrade to Pro.");
  }

  // Continue with creation...
}
```

Apply the identical logic to `src/actions/collections.ts` and the App Router upload route (`src/app/api/upload/route.ts`).
