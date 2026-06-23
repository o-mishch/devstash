// Tracks image previews that failed to LOAD in the browser. This is the genuinely non-TanStack half of
// preview handling: the signed-URL *fetch* succeeds (200 + a URL), but the browser's GET of that URL
// 404s because the S3 object is missing — an `<img onError>`, not an HTTP error, so TanStack Query never
// sees it. It therefore stays a plain module-level ledger, separate from the query-cache-backed signed-URL
// fetching in use-pro-download-src.ts. Surviving component remounts is the point: browsers don't cache
// 404s, so without this a scrolled-away-and-back card would re-request a URL already known to be dead.

/** Item IDs whose preview failed to load — checked during render to skip a known-broken <img>. */
const failedPreviewItems = new Set<string>()
/** Specific signed URLs that 404'd — once a URL fails, no component should retry that exact URL. */
const failedPreviewUrls = new Set<string>()

export function markPreviewFailed(itemId: string, url?: string): void {
  failedPreviewItems.add(itemId)
  if (url) failedPreviewUrls.add(url)
}

export function isPreviewFailed(itemId: string): boolean {
  return failedPreviewItems.has(itemId)
}

/**
 * Clears an item's failed flag so a manual reload can retry it. URL-level flags are intentionally NOT
 * cleared — a specific URL that 404'd stays dead; the reload fetches a fresh signed URL anyway, which
 * won't be in the failed-URL set.
 */
export function clearPreviewFailed(itemId: string): void {
  failedPreviewItems.delete(itemId)
}

export { failedPreviewItems, failedPreviewUrls }
