// Shared read/write for the ds-layout cookie that persists collapse state across page loads.
// Written on every toggle so the combined AppScript blocking script can apply the state before
// first paint — same pattern as the ds-theme cookie for the color theme.

export interface LayoutCookieValue {
  collections: boolean
  pinned: boolean
  recent: boolean
  // Sidebar collapsed state mirror — DB (editorPreferences.sidebarCollapsed) is the source of
  // truth; this is the pre-hydration no-flash hint read by the blocking script for skeleton width.
  sidebar: boolean
}

const COOKIE_NAME = 'ds-layout'
const COOKIE_MAX_AGE = 31536000 // 1 year

// Pure parser for the raw cookie value — shared by the client reader (document.cookie)
// and the server (next/headers cookies()) so both decode the persisted state identically.
export function parseLayoutCookie(raw: string | undefined): Partial<LayoutCookieValue> {
  if (!raw) return {}
  try {
    return JSON.parse(decodeURIComponent(raw)) as Partial<LayoutCookieValue>
  } catch {
    return {} // ignore malformed cookie
  }
}

export function readLayoutCookie(): Partial<LayoutCookieValue> {
  // document.cookie is the only browser API available to read cookies synchronously in client components/stores
  if (typeof document === 'undefined') return {}
  const match = document.cookie.match(/(?:^|;\s*)ds-layout=([^;]+)/)
  return parseLayoutCookie(match?.[1])
}

export function writeLayoutCookie(patch: Partial<LayoutCookieValue>): void {
  const current = readLayoutCookie()
  const next = { ...current, ...patch }
  // document.cookie is the only browser API available to write cookies synchronously in client components/stores.
  // Only the cookie is written here; it is consumed by the pre-hydration script (theme-script.tsx) to set the
  // html[data-section-*] no-flash attributes on the NEXT load. At runtime Base UI's Collapsible owns visibility,
  // so we must NOT touch those attributes here — doing so re-triggers the display:none guard and kills the
  // collapse animation (the guard is gated behind html[data-section-ready] once hydrated).
  if (typeof document !== 'undefined') {
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify(next))}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`
  }
}
