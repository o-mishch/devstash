// Shared read/write for the ds-layout cookie that persists collapse state across page loads.
// Written on every toggle so the combined AppScript blocking script can apply the state before
// first paint — same pattern as the ds-theme cookie for the color theme.

export interface LayoutCookieValue {
  collections: boolean
  pinned: boolean
  recent: boolean
}

const COOKIE_NAME = 'ds-layout'
const COOKIE_MAX_AGE = 31536000 // 1 year

export function readLayoutCookie(): Partial<LayoutCookieValue> {
  // document.cookie is the only browser API available to read cookies synchronously in client components/stores
  if (typeof document === 'undefined') return {}
  try {
    const match = document.cookie.match(/(?:^|;\s*)ds-layout=([^;]+)/)
    if (match?.[1]) return JSON.parse(decodeURIComponent(match[1])) as Partial<LayoutCookieValue>
  } catch {
    // ignore malformed cookie
  }
  return {}
}

export function writeLayoutCookie(patch: Partial<LayoutCookieValue>): void {
  const current = readLayoutCookie()
  const next = { ...current, ...patch }
  // document.cookie is the only browser API available to write cookies synchronously in client components/stores
  if (typeof document !== 'undefined') {
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify(next))}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`
    // Sync attributes on <html> element so globals.css collapse styles reflect the current state (preventing content from staying hidden on expand)
    const r = document.documentElement
    if (typeof next.collections === 'boolean') {
      r.setAttribute('data-section-collections', next.collections ? '1' : '0')
    }
    if (typeof next.pinned === 'boolean') {
      r.setAttribute('data-section-pinned', next.pinned ? '1' : '0')
    }
    if (typeof next.recent === 'boolean') {
      r.setAttribute('data-section-recent', next.recent ? '1' : '0')
    }
  }
}
