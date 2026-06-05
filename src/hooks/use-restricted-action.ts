'use client'

import { useState, useRef, useEffect } from 'react'
import { useUpgradePrompt, type UpgradePromptConfig } from '@/context/upgrade-prompt-context'

export function useRestrictedAction(config: UpgradePromptConfig) {
  const { showUpgradePrompt } = useUpgradePrompt()
  const [showError, setShowError] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  function flash() {
    if (timerRef.current) clearTimeout(timerRef.current)
    setShowError(true)
    showUpgradePrompt(config)
    timerRef.current = setTimeout(() => setShowError(false), 2000)
  }

  return { showError, flash }
}
