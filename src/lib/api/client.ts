import createFetchClient from 'openapi-fetch'
import type { Middleware } from 'openapi-fetch'
import createQueryClient from 'openapi-react-query'
import type { AiMutationApiPaths, PublicApiPaths } from '@/lib/api/ai-mutation-paths'

// Shared client options for the two typed views below (createClient holds no shared state between
// calls — each is an independent instance — so instantiating twice with the same options is safe and
// gives each view its own honest generic type, with no assertion needed to narrow it after the fact).
const CLIENT_OPTIONS = {
  baseUrl: typeof window !== 'undefined' ? `${window.location.origin}/api` : '/api',
  credentials: 'include' as const, // session cookie, same-origin — no auth middleware needed
}

// Centralize cross-cutting error logging in one middleware instead of at every call site.
// openapi-fetch does NOT throw on non-2xx — it returns { data, error }; openapi-react-query
// re-throws so TanStack's `error` state holds the typed { message, data? } body. (The shared Pino
// logger is server-only, so browser-side we log via console.) Only surface unexpected server errors
// (5xx) — the expected 4xx (401/403/404/422/429) are already handled at the call sites.
const logServerErrors: Middleware = {
  onResponse({ response }) {
    if (response.status >= 500) console.warn(`[api] ${response.status} ${response.url}`)
    return response
  },
}

// Typed client for the native Route Handlers, generated end-to-end from the OpenAPI `paths`
// (src/types/openapi.ts via `openapi:gen`). [C] — browser-safe.
// Type-narrowed to PublicApiPaths (excludes AiMutationPath, see ai-mutation-paths.ts) — calling one of
// those paths through `api`/`$api` is a compile error, not a lint rule.
const publicClient = createFetchClient<PublicApiPaths>(CLIENT_OPTIONS)
publicClient.use(logServerErrors)

export const api = publicClient // one-off calls: api.POST('/collections', { body })
export const $api = createQueryClient(api) // hooks: $api.useQuery('get', '/collections', …)

// Narrow, internal-only client scoped to exactly the AI-budget-consuming paths — imported solely by
// `useAiMutation` (src/hooks/ai/use-ai-usage.ts), which is the sole sanctioned caller.
const aiClient = createFetchClient<AiMutationApiPaths>(CLIENT_OPTIONS)
aiClient.use(logServerErrors)

export const aiMutationClient = aiClient
