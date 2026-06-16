'use client'

import type { MouseEvent } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api/client'
import { useRestrictedAction } from '@/hooks/use-restricted-action'

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

    const { error, data, response } = await api.GET('/download/{id}/url', { params: { path: { id: itemId } } })
    if (error) {
      if (response.status === 404) {
        showFileNotFoundToast(error.message)
      } else {
        toast.error(error.message || 'Failed to download file.')
      }
      return
    }

    // Programmatic anchor is the only way to trigger a named file download in
    // the browser. Content-Disposition: attachment in the presigned S3 URL
    // drives the save dialog without leaving the current page.
    const a = document.createElement('a')
    a.href = data.url
    a.click()
  }

  return { handleDownload, showError }
}
