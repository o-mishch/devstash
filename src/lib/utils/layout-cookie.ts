// Shared read/write for the ds-layout cookie that persists the sidebar collapsed state across page
// loads. DB (editorPreferences.sidebarCollapsed) is the source of truth; this cookie is the
// pre-hydration no-flash hint read by the blocking script (theme-script.tsx) so the sidebar
// skeleton renders at the correct width before hydration. (Dashboard section collapse state is no
// longer persisted — only the sidebar field remains.)

export interface LayoutCookieValue {
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
  // document.cookie is the only browser API available to write cookies synchronously in client
  // components/stores. The cookie is consumed by the pre-hydration script (theme-script.tsx) to set
  // the html[data-sidebar-collapsed] no-flash attribute on the NEXT load.
  if (typeof document !== 'undefined') {
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify(next))}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`
  }
}
