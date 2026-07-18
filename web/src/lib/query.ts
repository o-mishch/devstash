import { QueryClient } from '@tanstack/react-query'

/**
 * A fresh QueryClient per router instance. Server state lives here (the single
 * source of truth for the session and all domain data) — Zustand is UI-state only.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  })
}
