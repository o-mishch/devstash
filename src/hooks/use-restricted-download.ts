'use client'

import type { MouseEvent } from 'react'
import { useRestrictedAction } from '@/hooks/use-restricted-action'

export function useRestrictedDownload(
  href: string,
  fileName: string,
  isRestricted: boolean,
  stopPropagation = false,
  onUpgrade?: () => void,
  resolveHref?: () => Promise<string>
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
    const resolvedHref = resolveHref ? await resolveHref().catch(() => href) : href
    // Programmatic anchor is the only way to trigger a named file download in the browser
    const a = document.createElement('a')
    a.href = resolvedHref
    a.download = fileName
    a.click()
  }

  return { handleDownload, showError }
}
