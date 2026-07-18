/// <reference types="vite/client" />
import type { ReactNode } from 'react'
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
  useRouter,
} from '@tanstack/react-router'
import type { ErrorComponentProps } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { RouterCatchBoundary } from '@/components/app/catch-boundary'
import { RouterNotFound } from '@/components/app/not-found'
import { apiBaseUrl } from '@/lib/api/config'
import { SITE_NAME, SITE_URL, absoluteUrl } from '@/lib/site-config'
import appCss from '@/styles/app.css?url'
import svgToMiniDataURI from 'mini-svg-data-uri'
import faviconSvg from '@/assets/icons/favicon.svg?raw'

// The API is cross-origin in prod (https://api.devstash.one) — preconnect warms the TLS
// handshake for the post-hydration session fetch. In dev it's the same-origin `/api`
// proxy, so there is no separate origin to preconnect to.
const apiOrigin = apiBaseUrl.startsWith('http') ? new URL(apiBaseUrl).origin : null

// Site-wide structured data: WebSite + its publisher Organization. Emitted into every
// prerendered page's <head>; the post-build CSP hasher covers the inline block.
const siteJsonLd = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: SITE_NAME,
  url: SITE_URL,
  description:
    'One fast, searchable place for snippets, prompts, commands, notes, files, images, and links.',
  publisher: {
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_URL,
    logo: absoluteUrl('/og-image.png'),
  },
})

// Dynamically encoded static SVG data URI for favicon (saves ~30% size over raw encodeURIComponent)
const FAVICON_SVG_DATA_URI = svgToMiniDataURI(faviconSvg)

// __root stays PUBLIC — it wraps marketing (`/`) + auth pages. The protected subtree
// is guarded separately by the pathless `_app` layout route. The QueryClient rides in
// router context so children can `context.queryClient.ensureQueryData(...)`.
export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'color-scheme', content: 'dark' },
      // Near-black canvas (matches --background / the favicon rect) for browser UI chrome.
      { name: 'theme-color', content: '#0f1115' },
      { title: SITE_NAME },
      {
        name: 'description',
        content:
          'DevStash — one fast, searchable place for snippets, prompts, commands, notes, files, images, and links.',
      },
      // Site-wide Open Graph defaults; per-route heads (e.g. `/`) override title/description.
      { property: 'og:site_name', content: SITE_NAME },
      { property: 'og:type', content: 'website' },
    ],
    scripts: [{ type: 'application/ld+json', children: siteJsonLd }],
    links: [
      { rel: 'stylesheet', href: appCss },
      ...(apiOrigin === null
        ? []
        : [
            { rel: 'preconnect', href: apiOrigin, crossOrigin: 'use-credentials' as const },
            { rel: 'dns-prefetch', href: apiOrigin },
          ]),
      {
        rel: 'icon',
        type: 'image/svg+xml',
        href: FAVICON_SVG_DATA_URI,
      },
    ],
  }),
  errorComponent: (props: ErrorComponentProps) => (
    <RootDocument>
      <RouterCatchBoundary {...props} />
    </RootDocument>
  ),
  notFoundComponent: () => (
    <RootDocument>
      <RouterNotFound />
    </RootDocument>
  ),
  component: RootComponent,
})

function RootComponent(): ReactNode {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  )
}

interface RootDocumentProps {
  children: ReactNode
}

function RootDocument({ children }: RootDocumentProps): ReactNode {
  // Shell noindex: TanStack Start renders `_shell.html` with `isShell()` true (set only
  // during shell prerender). Firebase serves that shell for every non-static route via the
  // `**→_shell.html` rewrite and it has no real content, so crawlers must not index it. The
  // prerendered `/` (index.html) renders with isShell() false, so it stays indexable. This
  // is the framework-native replacement for the old post-build meta injection.
  const isShell = useRouter().isShell()
  // Product default: modern-minimal dark. The no-flash theme script + `useTheme` swap the
  // `data-theme` slug and `dark`/`light` class client-side from the user's saved preferences.
  return (
    <html lang="en" className="dark" data-theme="modern-minimal">
      <head>
        {isShell ? <meta name="robots" content="noindex" /> : null}
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
