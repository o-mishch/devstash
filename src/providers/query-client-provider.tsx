'use client'

import { useState, lazy, Suspense } from 'react'
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { ReactNode } from 'react'

const ReactQueryDevtools = process.env.NODE_ENV === 'development'
  ? lazy(() => import('@tanstack/react-query-devtools').then((m) => ({ default: m.ReactQueryDevtools })))
  : null

function makeQueryClient() {
  return new QueryClient({
    // Central safety net for unhandled READ failures: a query that wants its error surfaced sets
    // `meta: { errorMessage }` (typed via src/types/react-query.d.ts) and this single handler toasts it.
    // Opt-in by design — advisory queries that swallow errors (search → EMPTY_RESULT, ai-usage,
    // brain-dump sources) omit `meta` and stay silent.
    queryCache: new QueryCache({
      onError: (error, query) => {
        const message = query.meta?.errorMessage
        if (message) toast.error(message)
      },
    }),
    // Mirror of the query handler for WRITE failures: a mutation that wants a generic failure toast sets
    // `meta: { errorMessage }` (same typed shape, src/types/react-query.d.ts) and this single handler surfaces
    // it — letting shared mutation hooks drop bespoke `onError` toasts. Opt-in: mutations that need contextual
    // copy (3-way branching, field-level errors) keep their own `onError` and omit `meta`, so no double-toast.
    mutationCache: new MutationCache({
      onError: (error, variables, context, mutation) => {
        const message = mutation.meta?.errorMessage
        if (message) toast.error(message)
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
      },
    },
  })
}

interface AppQueryClientProviderProps {
  children: ReactNode
}

export function AppQueryClientProvider({ children }: AppQueryClientProviderProps) {
  const [queryClient] = useState(() => makeQueryClient())

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {ReactQueryDevtools && (
        <Suspense>
          <ReactQueryDevtools initialIsOpen={false} />
        </Suspense>
      )}
    </QueryClientProvider>
  )
}
