import { useQuery } from '@tanstack/react-query'
import type { UseQueryResult } from '@tanstack/react-query'
import { getActivityOptions } from '@/client/@tanstack/react-query.gen'
import type { ActivityOutputBody, ErrorModel } from '@/client'

/**
 * Per-day item-creation activity (84 contiguous days) for the Mission Control heatmap + sparkline.
 * Only that skin calls this, so no other dashboard load pays for it. Preferences-like staleness:
 * activity changes slowly, so keep it fresh for the session rather than refetching on focus.
 */
export function useActivity(): UseQueryResult<ActivityOutputBody, ErrorModel> {
  return useQuery({ ...getActivityOptions(), staleTime: 5 * 60 * 1000 })
}
