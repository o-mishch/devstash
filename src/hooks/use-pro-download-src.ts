'use client'

import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { $api } from '@/lib/api/client'
import { getDownloadUrl } from '@/lib/utils/url'
import { useAppUserFlagsStore } from '@/stores/app-user-flags'
import {
  SIGNED_URL_GC_TIME,
  DEFAULT_PREVIEW_SEED_TTL_MS,
  computeSignedUrlStaleTime,
} from '@/lib/api/signed-url-ttl'
import {
  clearPreviewFailed,
  failedPreviewItems,
  failedPreviewUrls,
} from '@/lib/api/preview-failure-tracker'

// Convenience re-exports so preview components have a single import for everything signed-URL related —
// the failure ledger is a plain util (no hook), the cache lives in the query options below.
export { markPreviewFailed, isPreviewFailed } from '@/lib/api/preview-failure-tracker'

const DOWNLOAD_SRC_PATH = '/download/{id}/url'

// Single source of truth for the request (key + queryFn + freshness) so the live reader (useQuery) and
// the imperative actions (fetchQuery / ensureQueryData / setQueryData / removeQueries) all hash to the
// same query key. The init must be a fresh literal here — $api widens it with an index signature.
function downloadSrcOptions(itemId: string, preview: boolean) {
  return $api.queryOptions(
    'get',
    DOWNLOAD_SRC_PATH,
    { params: { path: { id: itemId }, query: { preview } } },
    {
      staleTime: (query) => computeSignedUrlStaleTime(query.state.data?.expiresAt, query.state.dataUpdatedAt),
      gcTime: SIGNED_URL_GC_TIME,
    },
  )
}

/**
 * Resolves the best image `src` for a Pro-gated file/image item, backed by the TanStack Query cache.
 * Previews are available to all users; full downloads require Pro (non-Pro full downloads fall back to
 * the direct route URL). A cached signed URL is served instantly on first paint and refetched just
 * before it expires (see computeSignedUrlStaleTime). Returns null while loading or when the preview is
 * known to have failed to render.
 */
export function useProDownloadSrc(itemId: string, preview = false): string | null {
  const { isPro } = useAppUserFlagsStore()
  // Previews are available to all users; full downloads require Pro.
  const enabled = preview || isPro

  const { data } = useQuery({ ...downloadSrcOptions(itemId, preview), enabled })
  const url = data?.url ?? null

  if (preview) {
    if (failedPreviewItems.has(itemId)) return null
    if (url && failedPreviewUrls.has(url)) return null
    return url
  }

  if (isPro) return url

  // Non-Pro full download: serve the direct route URL (no signed fetch needed).
  return getDownloadUrl(itemId)
}

interface DownloadSrcActions {
  /** Force a fresh signed URL (clears the item's failed flag first) — the manual reload path. */
  refresh: (itemId: string, preview: boolean) => Promise<string | null>
  /** Return the cached signed URL or fetch it once — the on-demand path (e.g. lightbox open). */
  ensure: (itemId: string, preview: boolean) => Promise<string | null>
  /** Seed the preview cache with a local blob URL so a freshly uploaded thumb paints without an S3 round-trip. */
  seed: (itemId: string, localUrl: string, ttlMs?: number) => void
  /** Drop an item's cached signed URLs (both preview + full) and its failed flag. */
  clear: (itemId: string) => void
}

/**
 * Imperative signed-URL cache operations. All `queryClient` access lives here (per the cache-updater
 * rule) so components call these instead of `useQueryClient()` directly.
 */
export function useDownloadSrcActions(): DownloadSrcActions {
  const queryClient = useQueryClient()

  const refresh = useCallback(
    async (itemId: string, preview: boolean): Promise<string | null> => {
      // A manual reload retries a broken preview: drop its failed flag and force a fresh fetch (staleTime
      // 0 bypasses the cached, possibly-dead URL).
      clearPreviewFailed(itemId)
      try {
        const data = await queryClient.fetchQuery({ ...downloadSrcOptions(itemId, preview), staleTime: 0 })
        return data?.url ?? null
      } catch {
        return null
      }
    },
    [queryClient],
  )

  const ensure = useCallback(
    async (itemId: string, preview: boolean): Promise<string | null> => {
      try {
        const data = await queryClient.ensureQueryData(downloadSrcOptions(itemId, preview))
        return data?.url ?? null
      } catch {
        return null
      }
    },
    [queryClient],
  )

  const seed = useCallback(
    (itemId: string, localUrl: string, ttlMs = DEFAULT_PREVIEW_SEED_TTL_MS): void => {
      const expiresAt = new Date(Date.now() + ttlMs).toISOString()
      queryClient.setQueryData(downloadSrcOptions(itemId, true).queryKey, { url: localUrl, expiresAt })
    },
    [queryClient],
  )

  const clear = useCallback(
    (itemId: string): void => {
      clearPreviewFailed(itemId)
      queryClient.removeQueries({ queryKey: downloadSrcOptions(itemId, true).queryKey })
      queryClient.removeQueries({ queryKey: downloadSrcOptions(itemId, false).queryKey })
    },
    [queryClient],
  )

  return useMemo(() => ({ refresh, ensure, seed, clear }), [refresh, ensure, seed, clear])
}
