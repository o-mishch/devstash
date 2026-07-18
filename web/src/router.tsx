import type { ReactNode } from 'react'
import { createRouter } from '@tanstack/react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { routeTree } from './routeTree.gen'
import { createQueryClient } from '@/lib/query'
import { preferredScrollBehavior } from '@/lib/scroll-to-section'
import { installApiInterceptors } from '@/lib/api/client'
import { RouterPending } from '@/components/app/pending'
import { RouterCatchBoundary } from '@/components/app/catch-boundary'
import { RouterNotFound } from '@/components/app/not-found'

interface RootWrapProps {
  children: ReactNode
}

// TanStack Start calls getRouter() to build a router instance. The QueryClient is
// created here and threaded through router context so every loader/beforeLoad can
// `ensureQueryData`; the SAME instance backs the QueryClientProvider (via Wrap) so
// component `useQuery` reads the cache the loaders populated.
export function getRouter() {
  const queryClient = createQueryClient()

  // Resolved once at router creation (client-side): 'smooth' unless the OS prefers
  // reduced motion. Drives both page-transition restoration and in-page hash scrolling.
  const scrollBehavior = preferredScrollBehavior()

  const router = createRouter({
    routeTree,
    context: { queryClient },
    // Preload on intent (hover/focus); React Query owns caching, so the router keeps
    // no stale copy of loader data (staleTime 0 → always re-run the loader, which
    // itself hits the Query cache).
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
    // Smoothly animate scroll on route transitions and when a `<Link hash>` scrolls a
    // section (Features/Pricing) into view — the framework-native mechanism, so there's
    // no competing native-anchor jump. `block: 'start'` + html `scroll-padding-top`
    // lands the target below the fixed nav.
    scrollRestorationBehavior: scrollBehavior,
    defaultHashScrollIntoView: { behavior: scrollBehavior, block: 'start' },
    defaultPendingComponent: RouterPending,
    defaultErrorComponent: RouterCatchBoundary,
    defaultNotFoundComponent: RouterNotFound,
    Wrap: ({ children }: RootWrapProps) => (
      <QueryClientProvider client={queryClient}>
        {children}
        {/* Sonner injects a <style> tag (no inline scripts) → covered by the CSP's
            existing style-src 'unsafe-inline'. Dark theme to match the app shell. */}
        <Toaster theme="dark" position="bottom-right" richColors closeButton />
      </QueryClientProvider>
    ),
  })

  installApiInterceptors(queryClient, router)

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
