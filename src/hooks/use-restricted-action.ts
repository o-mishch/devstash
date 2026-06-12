'use client'

import { useState, useRef, useEffect } from 'react'
import { useUpgradePromptStore, type UpgradePromptConfig } from '@/stores/upgrade-prompt'

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
