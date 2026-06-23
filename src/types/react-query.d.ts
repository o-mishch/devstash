import '@tanstack/react-query'

// Module augmentation registering the app's typed `meta` shape for queries (and mutations). The global
// QueryCache `onError` in `query-client-provider.tsx` reads `meta.errorMessage` to surface a toast for an
// otherwise-unhandled READ failure — opt-in, so advisory queries (search, ai-usage, brain-dump sources)
// that deliberately swallow errors stay silent by simply omitting `meta`. Keeping the shape here makes it
// type-safe and consistent across every query/mutation.
interface AppQueryMeta extends Record<string, unknown> {
  // When set, a failed query toasts this message via the global QueryCache onError handler.
  errorMessage?: string
}

declare module '@tanstack/react-query' {
  interface Register {
    queryMeta: AppQueryMeta
    mutationMeta: AppQueryMeta
  }
}
