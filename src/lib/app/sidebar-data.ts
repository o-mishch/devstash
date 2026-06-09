import 'server-only'

import { cache } from 'react'
import { createLogger } from '@/lib/infra/logger'
import { fetchSidebarData } from '@/lib/db/sidebar'
import {
  maybeReconcileBillingStateForUser,
  maybeReconcileOrphanSubscriptionForUser,
  subscriptionSyncMutatedLocalState,
} from '@/lib/billing/sync/passive-billing-sync'
import { resolveProAccessForBillingContext } from '@/lib/billing/access/pro-access-resolution'
import type { FreshBillingContextOptions } from '@/lib/billing/sync/user-billing-state'

const log = createLogger('sidebar-data')

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
export async function resolveLayoutBillingSidebarOptions(
  userId: string | undefined,
): Promise<FreshBillingContextOptions> {
  if (!userId) return SIDEBAR_DEFAULT_OPTIONS

  const syncResult = await maybeReconcileBillingStateForUser(userId)
  const orphanLinked = await maybeReconcileOrphanSubscriptionForUser(userId)
  return subscriptionSyncMutatedLocalState(syncResult) || orphanLinked
    ? SIDEBAR_FRESH_OPTIONS
    : SIDEBAR_DEFAULT_OPTIONS
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
      await resolveLayoutBillingSidebarOptions(snapshot.userId),
      snapshot,
    )
  } catch (error) {
    log.warn('Failed to load sidebar billing data — using degraded shell', {
      userId: snapshot.userId,
      error,
    })
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
