import { z } from 'zod'
import { optionalSearchString } from './search'

const FALLBACK = '/dashboard'

// Control characters (incl. NUL, tab, newlines) and DEL.
// oxlint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/u

// Auth pages must never be a post-auth redirect target: bouncing a signed-in user back
// onto sign-in/register just re-triggers their "already signed in" guard.
const AUTH_PATHS = new Set([
  '/sign-in',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/link-account',
])

/**
 * Open-redirect guard. We only ever store a RELATIVE path (pathname+search+hash),
 * never `location.href`, and validate it ON CONSUMPTION: parse against the current
 * origin and confirm it stays same-origin. Rejects protocol-relative (`//`),
 * backslash tricks (`/\`), encoded slashes (`%2f%2f` / `%5c`), control chars, and
 * any target that resolves to an auth page.
 */
export function sanitizeRelative(raw: string | undefined | null): string {
  // Must be a plain absolute-path reference (this also rejects null/undefined/empty),
  // not protocol-relative or a backslash.
  if (raw == null || !raw.startsWith('/')) return FALLBACK
  if (raw.startsWith('//') || raw.startsWith('/\\')) return FALLBACK
  if (raw.includes('\\')) return FALLBACK
  if (CONTROL_CHARS.test(raw)) return FALLBACK

  const lower = raw.toLowerCase()
  if (lower.includes('%2f%2f') || lower.includes('%5c')) return FALLBACK

  if (typeof window === 'undefined') return FALLBACK
  // Justification: window.location.origin is a native browser global with no React/TanStack alternative.
  const origin = window.location.origin
  try {
    const url = new URL(raw, origin)
    if (url.origin !== origin) return FALLBACK
    // An auth path is a redirect loop waiting to happen — collapse it to the fallback.
    // Strip trailing slashes first so `/sign-in/` / `/sign-in//` don't slip past the set.
    const authPath = (url.pathname.replace(/\/+$/, '') || '/').toLowerCase()
    if (AUTH_PATHS.has(authPath)) return FALLBACK
    // Re-assert on the NORMALIZED output: path traversal (e.g. `/.//evil.com` or
    // `/..//evil.com`) survives the raw-input guards above but `new URL` collapses it
    // to a protocol-relative pathname (`//evil.com`) — exactly what we must reject.
    const out = `${url.pathname}${url.search}${url.hash}`
    if (out.startsWith('//') || out.startsWith('/\\')) return FALLBACK
    return out
  } catch {
    return FALLBACK
  }
}

/**
 * `validateSearch` schema for the `redirect` param on auth routes. The param is left
 * OFF (undefined) when absent — consumers apply `/dashboard` — so a bare `/sign-in`
 * never serializes a noisy `?redirect=/dashboard`. When present it is sanitized.
 */
export const redirectSearchSchema = z.object({
  redirect: optionalSearchString.transform((v) =>
    typeof v === 'string' ? sanitizeRelative(v) : undefined,
  ),
})
