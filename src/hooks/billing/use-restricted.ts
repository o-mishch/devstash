'use client'

import { useState, useRef, useEffect, type MouseEvent } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api/client'
import { useUpgradePromptStore, type UpgradePromptConfig } from '@/stores/upgrade-prompt'
import { showFileNotFoundToast } from '@/lib/dom/toast-error'

export function useRestrictedAction(config: UpgradePromptConfig) {
  const { openPrompt } = useUpgradePromptStore()
  const [showError, setShowError] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  function flash() {
    if (timerRef.current) clearTimeout(timerRef.current)
    setShowError(true)
    openPrompt(config)
    timerRef.current = setTimeout(() => setShowError(false), 2000)
  }

  return { showError, flash }
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
