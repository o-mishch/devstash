import 'server-only'

import { revalidateTag, updateTag } from 'next/cache'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'cache' })

// ─── Cache tag helpers ────────────────────────────────────────────────────────
// Single source of truth for all tag strings used by 'use cache' functions
// and invalidation calls in server actions.

export const CacheTags = {
  // Group tags — used for bulk eviction on mutation
  itemGroup: (userId: string) => `items-${userId}`,
  collectionGroup: (userId: string) => `collections-${userId}`,

  // Item tags
  pinnedItems: (userId: string) => `user:${userId}:pinned-items`,
  recentItems: (userId: string) => `user:${userId}:recent-items`,
  favoriteItems: (userId: string) => `user:${userId}:favorite-items`,
  favoriteItemTypeCounts: (userId: string) => `user:${userId}:favorite-item-type-counts`,
  itemsByType: (userId: string, type: string) => `user:${userId}:items:${type}`,
  itemStats: (userId: string) => `user:${userId}:item-stats`,
  sidebarTypes: (userId: string) => `user:${userId}:sidebar-types`,
  itemById: (userId: string, itemId: string) => `user:${userId}:item:${itemId}`,
  itemDetails: (userId: string, itemId: string) => `user:${userId}:item-details:${itemId}`,
  itemContent: (userId: string, itemId: string) => `user:${userId}:item-content:${itemId}`,
  downloadItem: (userId: string, itemId: string) => `user:${userId}:download-item:${itemId}`,
  itemsByCollection: (userId: string, collectionId: string) => `user:${userId}:collection:${collectionId}:items`,
  usageItemCount: (userId: string) => `user:${userId}:usage:item-count`,

  // Collection tags
  allCollections: (userId: string) => `user:${userId}:collections`,
  collectionsPreview: (userId: string) => `user:${userId}:collections-preview`,
  sidebarCollections: (userId: string) => `user:${userId}:sidebar-collections`,
  favoriteCollections: (userId: string) => `user:${userId}:favorite-collections`,
  collectionById: (userId: string, collectionId: string) => `user:${userId}:collection:${collectionId}`,
  collectionStats: (userId: string) => `user:${userId}:collection-stats`,
  usageCollectionCount: (userId: string) => `user:${userId}:usage:collection-count`,

  // Profile tag
  profile: (userId: string) => `user:${userId}:profile`,

  // Billing tags
  billingDisplayContext: (userId: string) => `billing-display-context:${userId}`,
  billingPageContext: (userId: string) => `billing-page-context:${userId}`,

  // Stripe subscription live state
  stripeSubscription: (subscriptionId: string) => `stripe:subscription:${subscriptionId}`,

  // System / shared tags (no userId — system-wide)
  itemTypeBySlug: (slug: string) => `item-type:slug:${slug}`,
  systemItemTypes: () => `system-item-types`,
} as const


// ─── Invalidation ─────────────────────────────────────────────────────────────
// `updateTag` causes immediate cache expiration and is only available in Server
// Actions. Route handlers (e.g. Stripe webhooks) must fall back to
// `revalidateTag(tag, 'max')` inside `after()`, which uses stale-while-revalidate
// — acceptable for billing data but wrong for mutations the user just performed.

function scheduleTagInvalidation(tag: string): void {
  // updateTag causes immediate expiry but only works in Server Actions.
  // Route Handlers fall through to revalidateTag (stale-while-revalidate).
  // revalidateTag is synchronous (in-memory pendingRevalidatedTags), so no after() needed.
  try {
    updateTag(tag)
    log.info({ tag }, 'cache tag updated')
    return
  } catch { /* not a Server Action — fall through to revalidateTag */ }

  try {
    revalidateTag(tag, 'max')
    log.info({ tag }, 'cache tag revalidated')
  } catch (err) {
    log.warn({ err }, 'Cache invalidation skipped')
  }
}

export function invalidateItemsCache(userId: string): void {
  scheduleTagInvalidation(CacheTags.itemGroup(userId))
}

export function invalidateCollectionsCache(userId: string): void {
  scheduleTagInvalidation(CacheTags.collectionGroup(userId))
}

export function invalidateProfileCache(userId: string): void {
  scheduleTagInvalidation(CacheTags.profile(userId))
}

export function invalidateStripeSubscriptionCache(subscriptionId: string): void {
  scheduleTagInvalidation(CacheTags.stripeSubscription(subscriptionId))
}

export function invalidateBillingCache(userId: string): void {
  scheduleTagInvalidation(CacheTags.billingDisplayContext(userId))
  scheduleTagInvalidation(CacheTags.billingPageContext(userId))
}
