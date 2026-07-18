import type { ReactNode } from 'react'
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import type { ErrorComponentProps } from '@tanstack/react-router'
import { sessionQueryOptions } from '@/auth/session'
import { sanitizeRelative } from '@/auth/redirect'
import { AppShell } from '@/components/app/app-shell'
import { RouterNotFound } from '@/components/app/not-found'
import { RouterCatchBoundary } from '@/components/app/catch-boundary'

/**
 * Pathless `_app` layout route — the auth guard for the whole protected subtree.
 * This is the router-context + beforeLoad pattern, NOT a root-layout component guard
 * (that's the Next-middleware anti-pattern). The guard is UX-only: every endpoint
 * IDOR-scopes independently server-side, so a bypass leaks nothing.
 *
 * `_app` is an underscore-prefixed pathless route (adds no URL segment), NOT a
 * `(app)` parens group (which is organizational only and wouldn't nest a layout).
 */
export const Route = createFileRoute('/_app')({
  // The protected subtree is client-only. The SSR dev server cannot see the auth
  // cookie (it's httpOnly and never forwarded to a server-side fetch) and the dev API
  // base URL is the browser-relative `/api`, so running `beforeLoad`'s session fetch on
  // the server always fails ("session request failed (network)") → 500 on hard-load.
  // With `ssr: false`, TanStack Start runs `beforeLoad`/loader/component on the CLIENT
  // during hydration (where the cookie and `/api` proxy exist), so the guard redirects
  // correctly and never touches the server. This also mirrors prod, where the whole app
  // ships as an SPA (client-only) anyway.
  ssr: false,
  beforeLoad: async ({ context, location, cause }) => {
    // Don't guard (or redirect) on hover/intent preload — only on a real navigation.
    // The actual navigation re-runs beforeLoad with cause 'enter'.
    if (cause === 'preload') return
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions)
    if (!session) {
      throw redirect({
        to: '/sign-in',
        // `location.href` is already the relative path+search+hash (TanStack's own value);
        // hand-assembling it dropped the `#` (ParsedLocation.hash excludes the leading char).
        search: { redirect: sanitizeRelative(location.href) },
      })
    }
  },
  component: AppLayout,
  // Keep 404s (e.g. an unknown `/items/<bad>`) and render errors INSIDE the app shell
  // so the user keeps the nav instead of being dropped to a bare full-page screen.
  // Both default to full-viewport height for standalone use; inside the shell they sit below
  // the header in an already-`min-h-dvh` column, so let them fill it rather than add to it.
  notFoundComponent: () => (
    <AppShell>
      <RouterNotFound className="min-h-0 flex-1" />
    </AppShell>
  ),
  errorComponent: (props: ErrorComponentProps) => (
    <AppShell>
      <RouterCatchBoundary {...props} className="min-h-0 flex-1" />
    </AppShell>
  ),
})

function AppLayout(): ReactNode {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}
