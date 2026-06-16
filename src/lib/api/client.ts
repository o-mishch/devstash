import createFetchClient from 'openapi-fetch'
import createQueryClient from 'openapi-react-query'
import type { paths } from '@/types/openapi'

// Typed client for the native Route Handlers, generated end-to-end from the OpenAPI `paths`
// (src/types/openapi.ts via `openapi:gen`). [C] — browser-safe.
const fetchClient = createFetchClient<paths>({
  baseUrl: typeof window !== 'undefined' ? `${window.location.origin}/api` : '/api',
  credentials: 'include', // session cookie, same-origin — no auth middleware needed
})

// Centralize cross-cutting error logging in one middleware instead of at every call site.
// openapi-fetch does NOT throw on non-2xx — it returns { data, error }; openapi-react-query
// re-throws so TanStack's `error` state holds the typed { message, data? } body. (The shared Pino
// logger is server-only, so browser-side we log via console.) Only surface unexpected server errors
// (5xx) — the expected 4xx (401/403/404/422/429) are already handled at the call sites.
fetchClient.use({
  onResponse({ response }) {
    if (response.status >= 500) console.warn(`[api] ${response.status} ${response.url}`)
    return response
  },
})

export const api = fetchClient // one-off calls: api.POST('/collections', { body })
export const $api = createQueryClient(fetchClient) // hooks: $api.useQuery('get', '/collections', …)
