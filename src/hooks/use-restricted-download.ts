'use client'

import type { MouseEvent } from 'react'
import { toast } from 'sonner'
import { get } from '@/lib/api/api-fetch'
import { useRestrictedAction } from '@/hooks/use-restricted-action'
import type { SignedDownloadUrlResponse } from '@/types/item'

export function showFileNotFoundToast(message?: string | null) {
  toast.error(message ?? 'File not found in storage.', {
    id: 'file-not-found',
  })
}

export function useRestrictedDownload(
  itemId: string,
  isRestricted: boolean,
  stopPropagation = false,
  onUpgrade?: () => void
) {
  const { showError, flash } = useRestrictedAction({
    title: 'Pro feature',
    description: 'Downloading files and images requires a Pro plan.',
    onUpgrade,
  })

  async function handleDownload(e: MouseEvent) {
    if (stopPropagation) e.stopPropagation()
    if (isRestricted) {
      flash()
      return
    }

    const result = await get<SignedDownloadUrlResponse>(`/api/download/${itemId}/url`)
    if (result.status === 'not_found') {
      showFileNotFoundToast(result.message)
      return
    }
    if (result.status !== 'ok' || !result.data?.url) {
      toast.error(result.message ?? 'Failed to download file.')
      return
    }

    // Programmatic anchor is the only way to trigger a named file download in
    // the browser. Content-Disposition: attachment in the presigned S3 URL
    // drives the save dialog without leaving the current page.
    const a = document.createElement('a')
    a.href = result.data.url
    a.click()
  }

  return { handleDownload, showError }
}
