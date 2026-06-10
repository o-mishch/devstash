'use client'

import type { MouseEvent } from 'react'
import { useRestrictedAction } from '@/hooks/use-restricted-action'

export function useRestrictedDownload(
  href: string,
  fileName: string,
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
    // Programmatic anchor is the only way to trigger a named file download in the browser
    const a = document.createElement('a')
    a.href = href
    a.download = fileName
    a.click()
  }

  return { handleDownload, showError }
}
