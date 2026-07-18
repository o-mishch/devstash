import { useQuery } from '@tanstack/react-query'
import type { UseQueryResult } from '@tanstack/react-query'
import { getStatsOptions } from '@/client/@tanstack/react-query.gen'
import type { ErrorModel, StatsOutputBody } from '@/client'

/**
 * Dashboard/profile stats: total & favorite item/collection counts + per-type counts. One
 * shared query drives the sidebar TYPES counts, the dashboard stat cards, the profile Usage
 * section, and the settings usage bars — TanStack dedupes them to a single request.
 */
export function useStats(): UseQueryResult<StatsOutputBody, ErrorModel> {
  return useQuery({ ...getStatsOptions(), staleTime: 60 * 1000 })
}

/** Per-type count lookup by system type name (e.g. 'snippet' → 3), 0 when absent. */
export function itemTypeCount(stats: StatsOutputBody | undefined, typeName: string): number {
  const match = stats?.itemTypeCounts?.find((t) => t.name === typeName)
  return match?.count ?? 0
}
