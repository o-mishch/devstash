import type { paths } from '@/types/openapi'

// The closed set of AI-budget-consuming mutation paths. `src/lib/api/client.ts` omits these from the
// public `api`/`$api` clients (compile error to call them directly) and `useAiMutation`
// (src/hooks/ai/use-ai-usage.ts) is the sole caller, via its own narrowed `aiMutationClient` — so the
// `/ai/usage` meter always refetches after one of these spends budget. Endpoints under `/ai/*` that
// don't spend budget (e.g. the brain-dump commit routes) are intentionally excluded from this union and
// stay reachable through the public client.
export type AiMutationPath =
  | '/ai/optimize'
  | '/ai/explain'
  | '/ai/tags'
  | '/ai/description'
  | '/ai/collection-description'
  | '/ai/brain-dump'
  | '/ai/brain-dump/{jobId}/re-parse'

// Method-level, not path-level: `/ai/brain-dump` carries both a budget-free `get` (list jobs) and the
// budget-consuming `post` (create job) on the same path key, so a path-level Omit would incorrectly
// drop the `get` too. Only the `post` method is stripped from AiMutationPath entries.
export type PublicApiPaths = {
  [Path in keyof paths]: Path extends AiMutationPath ? Omit<paths[Path], 'post'> : paths[Path]
}

export type AiMutationApiPaths = Pick<paths, AiMutationPath>
