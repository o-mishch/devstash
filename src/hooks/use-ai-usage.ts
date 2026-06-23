'use client'

import { useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api, $api } from '@/lib/api/client'
import { useInvalidate } from '@/hooks/use-cache-invalidation'
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
 * AI-usage cache invalidator — a thin alias over the central registry (`invalidate('aiUsage')`), which
 * derives the same `['get', '/ai/usage']` key from `queryKeys.aiUsage()`. Fire-and-forget; with the
 * default `refetchType: 'active'` it is a true no-op when the widget is unmounted, so callers can invoke
 * it unconditionally.
 */
export function useInvalidateAiUsage(): () => void {
  const invalidate = useInvalidate()
  return useCallback(() => invalidate('aiUsage'), [invalidate])
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
  | '/ai/brain-dump/{jobId}/re-parse'

type JsonBody<T> = T extends { content: { 'application/json': infer B } } ? B : never
type JsonSuccess<T> = T extends { responses: infer R }
  ? R extends { 200: { content: { 'application/json': infer D } } }
    ? D
    : R extends { 201: { content: { 'application/json': infer D } } }
      ? D
      : never
  : never

export type AiMutationBody<P extends AiMutationPath> = JsonBody<paths[P]['post']['requestBody']>
export type AiMutationData<P extends AiMutationPath> = JsonSuccess<paths[P]['post']>

// Discriminated union (like openapi-fetch's FetchResponse) so `if (error) …` narrows `data` to
// defined in the success branch.
export type AiMutationResult<P extends AiMutationPath> =
  | { data: AiMutationData<P>; error?: undefined; response: Response }
  | { data?: undefined; error: { message: string }; response: Response }

type AiMutationParamsArgs<P extends AiMutationPath> = paths[P]['post'] extends {
  parameters: { path: infer PathParams }
}
  ? [params: { path: PathParams }]
  : []

// The `body` argument: the endpoint's JSON request body, or `undefined` for a body-less endpoint
// (e.g. `…/re-parse`, which carries only its `jobId` path segment). Collapsing `never` → `undefined`
// lets callers pass `undefined` for a body-less path instead of inventing a value for a `never` param.
type AiMutationBodyArg<P extends AiMutationPath> = [AiMutationBody<P>] extends [never]
  ? undefined
  : AiMutationBody<P>

// Variables for the single AI useMutation. `P` is erased to the union here (the mutation is created once,
// not per call); the generic per-call signature is restored at the `useAiMutation` boundary below.
interface AiMutationVariables {
  path: AiMutationPath
  body: unknown
  // The per-path `{ path: … }` params arg; erased to `unknown` here and cast at the `api.POST` boundary.
  params?: unknown
}

/**
 * Hook form of an AI mutation backed by `useMutation`, with the `/ai/usage` meter invalidation pre-bound
 * in `onSettled` — so the meter refetches after success, error, or 429, reflecting the just-spent token.
 * `invalidate` is fire-and-forget, so the AI mutation never stays pending on the meter refetch. The
 * returned function keeps the generic per-call signature `(path, body, ...params) => AiMutationResult<P>`;
 * the mutationFn never throws (openapi-fetch resolves `{ data, error }`), so consumers branch on the result.
 */
export function useAiMutation(): <P extends AiMutationPath>(
  path: P,
  body: AiMutationBodyArg<P>,
  ...paramsArgs: AiMutationParamsArgs<P>
) => Promise<AiMutationResult<P>> {
  const invalidate = useInvalidateAiUsage()
  const { mutateAsync } = useMutation({
    mutationFn: async ({ path, body, params }: AiMutationVariables): Promise<AiMutationResult<AiMutationPath>> => {
      // `api.POST` is overloaded per concrete path; the union-typed `path` here can't collapse to one
      // overload. Both are derived from the same `paths` type, so the cast is sound — the runtime path +
      // body are exactly what the route contract expects.
      return (await api.POST(path, { body, params } as never)) as AiMutationResult<AiMutationPath>
    },
    onSettled: () => invalidate(),
  })
  return useCallback(
    <P extends AiMutationPath>(
      path: P,
      body: AiMutationBodyArg<P>,
      ...paramsArgs: AiMutationParamsArgs<P>
    ): Promise<AiMutationResult<P>> =>
      mutateAsync({ path, body, params: paramsArgs[0] }) as Promise<AiMutationResult<P>>,
    [mutateAsync],
  )
}
