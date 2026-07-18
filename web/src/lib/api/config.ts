import type { CreateClientConfig } from '@/client/client.gen'
import { envString, hasText } from '@/lib/utils'
import { sanitizeRelative } from '@/auth/redirect'

// Single source of truth for where the Go API lives.
//  - Dev: same-origin `/api` (proxied to local Go by Vite — no CORS locally).
//  - Prod: the Cloud Run origin directly (cross-origin, credentialed).
// A defined-but-empty `VITE_API_BASE_URL=""` (e.g. a blank CI substitution) reads as absent
// via envString so the `??` fallback fires — otherwise an empty base would route every prod
// request same-origin to Firebase instead of the API.
const apiBaseUrlOverride = envString(import.meta.env.VITE_API_BASE_URL)
export const apiBaseUrl = import.meta.env.DEV
  ? '/api'
  : (apiBaseUrlOverride ?? 'https://api.devstash.one')

/**
 * URL for an OAuth start endpoint. OAuth is a hard cross-origin, full-page redirect
 * (`window.location.assign`) — the browser leaves the SPA, hits the Go server, which
 * bounces to the provider and 302s back with the session cookie set. An optional `redirect`
 * (a sanitized same-origin path) is carried as a query param so a deep-linked sign-in lands
 * where it started; the Go server re-sanitizes and stores it on the state for the round-trip.
 * `redirect`, when present, is re-sanitized here via `sanitizeRelative` regardless of caller
 * discipline, so this function is self-defending against an open-redirect value rather than
 * trusting callers to have pre-sanitized it. `sanitizeRelative` always returns a non-empty
 * fallback path, so the `hasText` guard runs on the raw input — an absent `redirect` must still
 * produce a bare `base` URL, not one carrying a synthesized fallback.
 */
export function oauthStartUrl(provider: 'github' | 'google', redirect?: string): string {
  const base = `${apiBaseUrl}/auth/oauth/${provider}/start`
  return hasText(redirect)
    ? `${base}?redirect=${encodeURIComponent(sanitizeRelative(redirect))}`
    : base
}

// Prod hits https://api.devstash.one directly (cross-origin) — its origin must be in
// the backend's ALLOWED_ORIGINS, and every request carries the __Host-session cookie.
export const createClientConfig: CreateClientConfig = (config) => ({
  ...config,
  baseUrl: apiBaseUrl,
  // Send the session cookie on cross-origin requests (backend replies with
  // Access-Control-Allow-Credentials: true).
  credentials: 'include',
})
