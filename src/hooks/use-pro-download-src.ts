'use client'

import { useEffect, useState } from 'react'
import { safe } from '@orpc/client'
import { orpcClient } from '@/lib/api/client'
import { getDownloadUrl } from '@/lib/utils/url'
import { useAppUserFlagsStore } from '@/stores/app-user-flags'
import type { SignedDownloadUrlResponse } from '@/types/item'

interface SignedSrcState {
  itemId: string
  url: string
}

interface CachedSignedDownloadUrl {
  url: string
  expiresAt: number
}

const SIGNED_URL_EXPIRY_BUFFER_MS = 30_000
const signedDownloadUrlCache = new Map<string, CachedSignedDownloadUrl>()
const inFlightRequests = new Map<string, Promise<string | null>>()
// Tracks preview items/URLs that returned a non-200. Survives component remounts so
// the browser never re-requests a URL that already failed (browsers don't cache 404).
const failedPreviewItems = new Set<string>()
// URL-level tracking: once a specific signed URL 404s, no component should retry it.
const failedPreviewUrls = new Set<string>()

function cacheKey(itemId: string, preview: boolean): string {
  return preview ? `${itemId}:preview` : itemId
}

function getCachedSignedDownloadUrl(itemId: string, preview: boolean): string | null {
  const cached = signedDownloadUrlCache.get(cacheKey(itemId, preview))
  if (!cached) return null
  if (cached.expiresAt - SIGNED_URL_EXPIRY_BUFFER_MS <= Date.now()) {
    signedDownloadUrlCache.delete(cacheKey(itemId, preview))
    return null
  }
  return cached.url
}

function setCachedSignedDownloadUrl(itemId: string, data: SignedDownloadUrlResponse, preview: boolean): void {
  const expiresAt = new Date(data.expiresAt).getTime()
  if (!Number.isFinite(expiresAt)) return
  signedDownloadUrlCache.set(cacheKey(itemId, preview), { url: data.url, expiresAt })
}

async function resolveSignedDownloadUrl(itemId: string, preview = false): Promise<string | null> {
  const cached = getCachedSignedDownloadUrl(itemId, preview)
  if (cached) return cached

  const key = cacheKey(itemId, preview)
  const inFlight = inFlightRequests.get(key)
  if (inFlight) return inFlight

  const request = safe(orpcClient.download.getSignedUrl({ id: itemId, preview })).then(({ error, data }) => {
    inFlightRequests.delete(key)
    if (!error) {
      setCachedSignedDownloadUrl(itemId, data, preview)
      return data.url
    }
    return null
  })
  inFlightRequests.set(key, request)
  return request
}

export function useProDownloadSrc(itemId: string, preview = false): string | null {
  const { isPro } = useAppUserFlagsStore()

  const [signedSrc, setSignedSrc] = useState<SignedSrcState | null>(() => {
    const cached = getCachedSignedDownloadUrl(itemId, preview)
    return cached ? { itemId, url: cached } : null
  })

  useEffect(() => {
    // Previews are available to all users; full downloads require Pro.
    if (!preview && !isPro) return

    const controller = new AbortController()
    resolveSignedDownloadUrl(itemId, preview).then((url) => {
      if (!controller.signal.aborted && url) {
        setSignedSrc({ itemId, url })
      }
    })
    return () => controller.abort()
  }, [itemId, isPro, preview])

  if (preview) {
    if (failedPreviewItems.has(itemId)) return null
    const signedUrl = signedSrc?.itemId === itemId ? signedSrc.url : getCachedSignedDownloadUrl(itemId, true)
    if (signedUrl && failedPreviewUrls.has(signedUrl)) return null
    return signedUrl ?? null
  }

  if (isPro) {
    const signedUrl = signedSrc?.itemId === itemId ? signedSrc.url : getCachedSignedDownloadUrl(itemId, false)
    return signedUrl ?? null
  }

  return getDownloadUrl(itemId)
}

/**
 * Pre-seeds the preview cache with a local blob URL (e.g. an ObjectURL from a freshly uploaded
 * thumbnail). Prevents an immediate API round-trip for the given itemId — the normal signed URL
 * fetch fires only after this entry expires.
 */
export function seedPreviewCache(itemId: string, localUrl: string, ttlMs = 5 * 60 * 1000): void {
  signedDownloadUrlCache.set(cacheKey(itemId, true), { url: localUrl, expiresAt: Date.now() + ttlMs })
}

export function clearSignedDownloadUrlCache(itemId: string): void {
  signedDownloadUrlCache.delete(itemId)
  signedDownloadUrlCache.delete(`${itemId}:preview`)
  inFlightRequests.delete(itemId)
  inFlightRequests.delete(`${itemId}:preview`)
  failedPreviewItems.delete(itemId)
}

export function markPreviewFailed(itemId: string, url?: string): void {
  failedPreviewItems.add(itemId)
  if (url) failedPreviewUrls.add(url)
}

export function isPreviewFailed(itemId: string): boolean {
  return failedPreviewItems.has(itemId)
}

export const getSignedDownloadUrl = resolveSignedDownloadUrl
