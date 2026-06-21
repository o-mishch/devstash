'use client'

import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, $api } from '@/lib/api/client'
import { useAppUserFlagsStore } from '@/stores/app-user-flags'
import type { components, paths } from '@/types/openapi'

// Read-only AI usage meter, layered on the Redis sliding-window rate limits. This is the repo's
// first `$api` *query* hook. The query takes no params, so `init` is undefined and the cache key is
// exactly `['get', '/ai/usage']` — `useInvalidateAiUsage` derives the identical key from the same
// (omitted) init so an AI mutation's invalidation always matches.
const AI_USAGE_PATH = '/ai/usage' as const

export type AiFeatureUsage = components['schemas']['AiUsage']['features'][number]

const POLL_MS = 60_000

// Polls every 60s while any meter is counting down, but stops entirely once every meter — the four
// per-feature budgets AND the Brain Dump (`brainDump`) quota — is back at full budget, since nothing
// is sliding. A mutation invalidation wakes it again. `query.state.data` is the last AiUsage payload.
interface UsagePollData {
  features?: AiFeatureUsage[]
  brainDump?: AiFeatureUsage
}
function usageRefetchInterval(query: { state: { data?: UsagePollData } }): number | false {
  const data = query.state.data
  if (!data) return POLL_MS
  const meters = [...(data.features ?? []), ...(data.brainDump ? [data.brainDump] : [])]
  if (meters.length > 0 && meters.every((m) => m.remaining >= m.limit)) return false
  return POLL_MS
}

/**
 * Subscribes to the current user's remaining AI budget per feature. Gated to Pro via `enabled`
 * (which disables both the query and its refetch interval), polls only while counting down and only
 * while the tab is focused, and treats data as fresh for 30s.
 */
export function useAiUsage() {
  const isPro = useAppUserFlagsStore((s) => s.isPro)
  return $api.useQuery('get', AI_USAGE_PATH, undefined, {
    enabled: isPro,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
    refetchInterval: usageRefetchInterval,
  })
}

/**
 * The single place that touches `queryClient` for the AI-usage cache. Returns a fire-and-forget
 * invalidator; with the default `refetchType: 'active'` it is a true no-op when the widget is
 * unmounted (nothing active to refetch), so callers can invoke it unconditionally.
 */
export function useInvalidateAiUsage(): () => void {
  const queryClient = useQueryClient()
  return useCallback(() => {
    // Same `init` (omitted) as `useAiUsage`, so the `[method, path]` key matches exactly.
    const { queryKey } = $api.queryOptions('get', AI_USAGE_PATH)
    void queryClient.invalidateQueries({ queryKey })
  }, [queryClient])
}

// ── AI mutation wrapper ─────────────────────────────────────────────────────────────────────────
// Every consuming AI mutation routes through here so the usage meter refetches after the budget is
// spent. `api.POST('/ai/…')` is banned elsewhere by the `no-restricted-syntax` ESLint rule.
export type AiMutationPath =
  | '/ai/optimize'
  | '/ai/explain'
  | '/ai/tags'
  | '/ai/description'
  | '/ai/collection-description'
  | '/ai/brain-dump'

type JsonBody<T> = T extends { content: { 'application/json': infer B } } ? B : never
type Json200<T> = T extends { responses: { 200: { content: { 'application/json': infer D } } } } ? D : never

export type AiMutationBody<P extends AiMutationPath> = JsonBody<paths[P]['post']['requestBody']>
export type AiMutationData<P extends AiMutationPath> = Json200<paths[P]['post']>

// Discriminated union (like openapi-fetch's FetchResponse) so `if (error) …` narrows `data` to
// defined in the success branch.
export type AiMutationResult<P extends AiMutationPath> =
  | { data: AiMutationData<P>; error?: undefined; response: Response }
  | { data?: undefined; error: { message: string }; response: Response }

/**
 * POSTs an AI mutation and ALWAYS invalidates `/ai/usage` afterwards — on success, error, or 429 —
 * so the meter reflects the just-spent token. `invalidate` is fire-and-forget (not awaited), so an
 * AI mutation never stays pending on the meter refetch.
 */
export async function runAiMutation<P extends AiMutationPath>(
  path: P,
  body: AiMutationBody<P>,
  invalidate: () => void,
): Promise<AiMutationResult<P>> {
  try {
    // `api.POST` is overloaded per concrete path; `P` is a generic union member, so the body and
    // return type can't collapse to one overload. Both are derived from the same `paths` type, so
    // the cast is sound — the runtime path + body are exactly what the route contract expects.
    return (await api.POST(path as AiMutationPath, { body } as never)) as AiMutationResult<P>
  } finally {
    invalidate()
  }
}

/** Hook form of `runAiMutation` with the `/ai/usage` invalidation pre-bound. */
export function useAiMutation(): <P extends AiMutationPath>(
  path: P,
  body: AiMutationBody<P>,
) => Promise<AiMutationResult<P>> {
  const invalidate = useInvalidateAiUsage()
  return useCallback(
    (path, body) => runAiMutation(path, body, invalidate),
    [invalidate],
  )
}
