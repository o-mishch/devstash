import { createORPCClient } from '@orpc/client'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { ResponseValidationPlugin } from '@orpc/contract/plugins'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import type { ContractRouterClient } from '@orpc/contract'
import { contract } from './contract'

const link = new OpenAPILink(contract, {
  url: typeof window !== 'undefined' ? `${window.location.origin}/api` : '/api',
  // Send the session cookie on same-origin requests.
  fetch: (request, init) => globalThis.fetch(request, { ...init, credentials: 'include' }),
  // Validate + coerce responses through the contract's output schemas so the client receives
  // the real types (e.g. z.coerce.date<Date>() → Date), not the raw JSON wire types. This
  // replaces the JsonifiedClient wrapper and keeps the existing Date-based domain types intact.
  plugins: [new ResponseValidationPlugin(contract)],
})

export const orpcClient: ContractRouterClient<typeof contract> = createORPCClient(link)

// TanStack Query utils — queryOptions / infiniteOptions / mutationOptions / typed keys.
export const orpc = createTanstackQueryUtils(orpcClient)
