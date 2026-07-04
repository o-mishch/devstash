import 'server-only'

import { cache } from 'react'
import { after } from 'next/server'
import { logger } from '@/lib/infra/pino'
import { fetchSidebarData } from '@/lib/db/sidebar'
import {
  maybeReconcileBillingStateForUser,
  maybeReconcileOrphanSubscriptionForUser,
} from '@/lib/billing/sync/passive-billing-sync'
import { resolveProAccessForBillingContext } from '@/lib/billing/access/pro-access-resolution'
import type { FreshBillingContextOptions } from '@/lib/billing/sync/user-billing-state'

const log = logger.child({ tag: 'sidebar-data' })

/** Stable cache keys for `getCachedSidebarData` — always pass one of these. */
export const SIDEBAR_DEFAULT_OPTIONS = {} as const satisfies FreshBillingContextOptions
export const SIDEBAR_FRESH_OPTIONS = { freshBillingContext: true } as const satisfies FreshBillingContextOptions

export interface SidebarSessionSnapshot {
  userId: string | undefined
  name: string | null
  email: string | null
  image: string | null
}

interface AppSessionLike {
  user?: {
    id?: string
    name?: string | null
    email?: string | null
    image?: string | null
    /** Session display fallback — not for gating. */
    isPro?: boolean
  }
}

function toSidebarSessionSnapshot(session: AppSessionLike | null): SidebarSessionSnapshot {
  const sessionUser = session?.user
  return {
    userId: sessionUser?.id,
    name: sessionUser?.name ?? null,
    email: sessionUser?.email ?? null,
    image: sessionUser?.image ?? null,
  }
}

/** Passive sync, throttled orphan reconcile, and sidebar cache options for the app layout. */
export function resolveLayoutBillingSidebarOptions(
  userId: string | undefined,
): FreshBillingContextOptions {
  if (!userId) return SIDEBAR_DEFAULT_OPTIONS

  // Defer passive billing sync to background (non-blocking).
  // Webhooks + next request will heal any stale state if sync would have mutated state.
  try {
    after(async () => {
      try {
        await maybeReconcileBillingStateForUser(userId)
        await maybeReconcileOrphanSubscriptionForUser(userId)
      } catch (error) {
        log.warn({ userId, err: error }, 'Background billing sync failed')
      }
    })
  } catch {
    // `after()` requires a request scope (not available in tests or during prerendering).
    // In test/prerender contexts, billing sync simply doesn't run — this is acceptable
    // since these are non-critical operations that webhooks will handle.
  }

  // Return immediately with default options — sidebar renders without waiting for Stripe API calls.
  return SIDEBAR_DEFAULT_OPTIONS
}

async function loadSidebarData(
  options: FreshBillingContextOptions,
  session: SidebarSessionSnapshot,
) {
  const { userId, name, email, image } = session

  const isPro = userId
    ? await resolveProAccessForBillingContext(userId, options)
    : false

  const user = userId ? { id: userId, name, email, image, isPro } : null
  return fetchSidebarData(user)
}

/** Request-scoped sidebar data with live Pro status — shared by layout and pages. */
export const getCachedSidebarData = cache(loadSidebarData)

/** Passive sync + cached sidebar data for the app shell and child pages. */
export const loadAppSidebarData = cache(async (session: AppSessionLike | null) => {
  const snapshot = toSidebarSessionSnapshot(session)
  try {
    return await getCachedSidebarData(
      resolveLayoutBillingSidebarOptions(snapshot.userId),
      snapshot,
    )
  } catch (error) {
    log.warn({
      userId: snapshot.userId,
      err: error,
    }, 'Failed to load sidebar billing data — using degraded shell')
    const fallbackUser = snapshot.userId
      ? {
          id: snapshot.userId,
          name: snapshot.name,
          email: snapshot.email,
          image: snapshot.image,
          isPro: session?.user?.isPro ?? false,
        }
      : null
    return fetchSidebarData(fallbackUser)
  }
})
