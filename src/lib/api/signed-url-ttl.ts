// Signed S3 download URLs expire server-side. These helpers drive how long TanStack Query treats a
// cached signed URL as fresh — long enough to avoid refetch churn while scrolling a virtualized grid,
// but expiring just before the URL itself does so a render never hands a soon-dead URL to an <img>.

/** Refetch this many ms before the server-side expiry, so an in-flight render never uses a dying URL. */
export const SIGNED_URL_EXPIRY_BUFFER_MS = 30_000
/** Hold cached signed URLs roughly as long as they stay valid (~1h) so remounting cards don't refetch. */
export const SIGNED_URL_GC_TIME = 60 * 60 * 1000
/** Default lifetime of a seeded local blob-URL preview (a freshly uploaded thumbnail). */
export const DEFAULT_PREVIEW_SEED_TTL_MS = 5 * 60 * 1000

/**
 * staleTime (ms measured from when the data was fetched, i.e. `dataUpdatedAt`) for a cached signed URL:
 * keep it fresh until `expiresAt - buffer`, then mark it stale so the next observe refetches. Returns 0
 * (immediately stale) when there's no data or an unparseable expiry. Mirrors the pre-migration cache's
 * expiry check exactly (`cached.expiresAt - buffer <= now` → expired).
 */
export function computeSignedUrlStaleTime(expiresAt: string | undefined, dataUpdatedAt: number): number {
  if (!expiresAt) return 0
  const expiresAtMs = new Date(expiresAt).getTime()
  if (!Number.isFinite(expiresAtMs)) return 0
  return Math.max(0, expiresAtMs - SIGNED_URL_EXPIRY_BUFFER_MS - dataUpdatedAt)
}
