'use client'

import { useEffect } from 'react'
import { $api } from '@/lib/api/client'
import { useUserProfile, usePatchUserProfile } from '@/hooks/profile/use-user-profile'
import type { BillingContextResponse } from '@/lib/api/schemas/billing'

interface UseBillingContextOptions {
  initialData?: BillingContextResponse
}

export function useBillingContext(options?: UseBillingContextOptions) {
  // init `undefined` (not `{}`) so the observed key is `['get','/billing/context']` — matching
  // queryKeys.billingContext() exactly so invalidation reaches this observer. `initialData` seeds
  // the shared cache on first mount.
  const query = $api.useQuery('get', '/billing/context', undefined, {
    initialData: options?.initialData,
    meta: { errorMessage: 'Failed to load billing details' },
  })

  return {
    ...query,
    billingContext: query.data,
  }
}

/**
 * Reconciles the `/profile/me` Pro flag from the (fresher) billing context, so the sidebar reflects an
 * upgrade as soon as the settings page reads `freshBillingContext` on a checkout return — before the
 * Stripe webhook lands. Lives here beside the billing query (not as an ad-hoc render effect in the
 * component) per the cache-updater-in-hook rule. Patches only when the values differ; the patch makes
 * them equal, so it self-terminates.
 */
export function useReconcileProFlag(isPro: boolean | undefined): void {
  const patchUserProfile = usePatchUserProfile()
  const seededIsPro = useUserProfile().data?.isPro
  useEffect(() => {
    if (isPro !== undefined && isPro !== seededIsPro) patchUserProfile({ isPro })
  }, [isPro, seededIsPro, patchUserProfile])
}
