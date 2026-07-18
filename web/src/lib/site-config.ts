import { envString } from '@/lib/utils'

// Single source of truth for the site's own public origin — the value baked into every
// absolute, crawler-facing URL (canonical, og:url, og:image, sitemap, JSON-LD).
//
// Sibling of `apiBaseUrl` (api/config.ts): that is where the Go API lives, this is where
// the marketing site itself is served. NOT the old app's `NEXTAUTH_URL` — that is a
// server-only var of the retired Next.js app and is never exposed to a browser bundle.
//
// In prod, VITE_SITE_URL is injected by the web Cloud Build step from Terraform's
// `firebase_custom_domain` (infra/terraform/envs/prod), so the site origin has one source
// of truth and auto-flips to the apex at cutover. The literal below is only the local
// `npm run build` / dev fallback.
//
// A build-time constant (not window.location.origin) is required because the homepage is
// prerendered — `window` does not exist when these tags are written into the static HTML.
// A defined-but-empty `VITE_SITE_URL=""` reads as absent via envString so the `??` fallback
// fires — otherwise an empty origin later throws in `new URL(path, '')` at prerender time.
const siteUrlOverride = envString(import.meta.env.VITE_SITE_URL)
export const SITE_URL = siteUrlOverride ?? 'https://beta.devstash.one'

/** Absolute, crawler-safe URL for a site-relative path (leading slash optional). */
export function absoluteUrl(path = '/'): string {
  return new URL(path, SITE_URL).href
}

// Human-readable site/brand name used in <title>, og:site_name, and JSON-LD.
export const SITE_NAME = 'DevStash'

// Social preview card (1200×630) — absolute URL required for crawler unfurls.
export const OG_IMAGE_URL = absoluteUrl('/og-image.png')
