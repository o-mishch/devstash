'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api/api-fetch'
import { getDownloadUrl } from '@/lib/utils/url'
import { useAppUserFlagsStore } from '@/stores/app-user-flags'
import type { SignedDownloadUrlResponse } from '@/types/item'

interface SignedSrcState {
  itemId: string
  preview: boolean
  url: string
}

interface CachedSignedDownloadUrl {
  url: string
  expiresAt: number
}

const SIGNED_URL_EXPIRY_BUFFER_MS = 30_000
const signedDownloadUrlCache = new Map<string, CachedSignedDownloadUrl>()
const inFlightRequests = new Map<string, Promise<string | null>>()

function getSignedDownloadUrlCacheKey(itemId: string, preview: boolean): string {
  return `${itemId}:${preview ? 'preview' : 'full'}`
}

function getCachedSignedDownloadUrl(itemId: string, preview: boolean): string | null {
  const cached = signedDownloadUrlCache.get(getSignedDownloadUrlCacheKey(itemId, preview))
  if (!cached) return null
  if (cached.expiresAt - SIGNED_URL_EXPIRY_BUFFER_MS <= Date.now()) {
    signedDownloadUrlCache.delete(getSignedDownloadUrlCacheKey(itemId, preview))
    return null
  }
  return cached.url
}

function cacheSignedDownloadUrl(itemId: string, preview: boolean, data: SignedDownloadUrlResponse): void {
  const expiresAt = new Date(data.expiresAt).getTime()
  if (!Number.isFinite(expiresAt)) return

  signedDownloadUrlCache.set(getSignedDownloadUrlCacheKey(itemId, preview), {
    url: data.url,
    expiresAt,
  })
}

async function resolveSignedDownloadUrl(itemId: string, preview = false): Promise<string | null> {
  const cached = getCachedSignedDownloadUrl(itemId, preview)
  if (cached) return cached

  const key = getSignedDownloadUrlCacheKey(itemId, preview)
  const inFlight = inFlightRequests.get(key)
  if (inFlight) return inFlight

  const query = preview ? '?preview=1' : ''
  const request = apiFetch<SignedDownloadUrlResponse>(`/api/download/${itemId}/url${query}`).then((result) => {
    inFlightRequests.delete(key)
    if (result.status === 'ok' && result.data?.url) {
      cacheSignedDownloadUrl(itemId, preview, result.data)
      return result.data.url
    }
    return null
  })
  inFlightRequests.set(key, request)
  return request
}

export function useProDownloadSrc(itemId: string, preview = false): string | null {
  const { isPro } = useAppUserFlagsStore()
  const proxyUrl = getDownloadUrl(itemId, { preview })
  const [signedSrc, setSignedSrc] = useState<SignedSrcState | null>(() => {
    const cached = getCachedSignedDownloadUrl(itemId, preview)
    return cached ? { itemId, preview, url: cached } : null
  })

  useEffect(() => {
    if (!isPro && !preview) return

    const controller = new AbortController()

    resolveSignedDownloadUrl(itemId, preview).then((url) => {
      if (!controller.signal.aborted && url) {
        setSignedSrc({ itemId, preview, url })
      }
    })

    return () => controller.abort()
  }, [itemId, preview, isPro, proxyUrl])

  const signedUrl = signedSrc?.itemId === itemId && signedSrc.preview === preview
    ? signedSrc.url
    : getCachedSignedDownloadUrl(itemId, preview)

  if (isPro || preview) {
    return signedUrl ?? null
  }

  return proxyUrl
}

export function clearSignedDownloadUrlCache(itemId: string, preview: boolean): void {
  signedDownloadUrlCache.delete(getSignedDownloadUrlCacheKey(itemId, preview))
  inFlightRequests.delete(getSignedDownloadUrlCacheKey(itemId, preview))
}

export const getSignedDownloadUrl = resolveSignedDownloadUrl
