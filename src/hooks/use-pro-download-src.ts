'use client'

import { useEffect, useState } from 'react'
import { getDownloadUrl } from '@/lib/utils/url'
import { useAppUserFlagsStore } from '@/stores/app-user-flags'
import {
  getCachedSignedDownloadUrl,
  getSignedDownloadUrl,
  failedPreviewItems,
  failedPreviewUrls,
} from '@/lib/api/signed-download-cache'

export {
  seedPreviewCache,
  clearSignedDownloadUrlCache,
  markPreviewFailed,
  isPreviewFailed,
  getSignedDownloadUrl,
} from '@/lib/api/signed-download-cache'

interface SignedSrcState {
  itemId: string
  url: string
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
    getSignedDownloadUrl(itemId, preview).then((url) => {
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
