// Shared read/write for the ds-layout cookie that persists the sidebar collapsed state across
// page loads. The DB (editorPreferences.sidebarCollapsed) is the source of truth; this cookie is
// the pre-load hint the shell reads on first render so the rail starts at the saved width instead
// of flashing expanded until the preferences query resolves.

export interface LayoutCookieValue {
  sidebar: boolean
}

const COOKIE_NAME = 'ds-layout'
// One year.
const COOKIE_MAX_AGE = 31536000

/**
 * Pure parser for the raw cookie value; anything malformed reads as "nothing saved". The parsed
 * value is narrowed structurally rather than asserted — it is untrusted input from a cookie the
 * user can edit, so a bad shape must degrade to the default, not corrupt the layout.
 */
export function parseLayoutCookie(raw: string | undefined): Partial<LayoutCookieValue> {
  if (raw === undefined || raw === '') return {}
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(raw))
    if (typeof parsed !== 'object' || parsed === null || !('sidebar' in parsed)) return {}
    return typeof parsed.sidebar === 'boolean' ? { sidebar: parsed.sidebar } : {}
  } catch {
    return {}
  }
}

export function readLayoutCookie(): Partial<LayoutCookieValue> {
  // document.cookie is the only synchronous browser API for reading cookies; there is no
  // framework-level alternative. Guarded because the dev server renders this on the server.
  if (typeof document === 'undefined') return {}
  const match = /(?:^|;\s*)ds-layout=([^;]+)/.exec(document.cookie)
  return parseLayoutCookie(match?.[1])
}

export function writeLayoutCookie(patch: Partial<LayoutCookieValue>): void {
  if (typeof document === 'undefined') return
  const next = { ...readLayoutCookie(), ...patch }
  // document.cookie is likewise the only synchronous write API. Lax is sufficient (no cross-site
  // need) and path=/ so every route sees it on the next cold load.
  const secure = location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify(next))}; path=/; max-age=${String(COOKIE_MAX_AGE)}; SameSite=Lax${secure}`
}
