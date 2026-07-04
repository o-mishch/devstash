'use client'

import { useState, useCallback } from 'react'
import { toastError } from '@/lib/dom/toast-error'

interface UseAiFieldGenerateParams<T> {
  canGenerate: boolean
  onGenerate: () => Promise<T>
  onSuccess: (data: T) => void
  onStart?: () => void
  failureMessage: string
}

interface UseAiFieldGenerateResult {
  isLoading: boolean
  run: () => void
}

export function useAiFieldGenerate<T>({
  canGenerate,
  onGenerate,
  onSuccess,
  onStart,
  failureMessage,
}: UseAiFieldGenerateParams<T>): UseAiFieldGenerateResult {
  const [isLoading, setIsLoading] = useState(false)

  // Fire-and-forget: consumers wire this to an onClick, so expose a void-returning runner.
  // Guard against double-tap: callers disable the button via `isLoading`, but this hook-level
  // check is defense-in-depth so two concurrent generations can never fire.
  const run = useCallback(() => {
    if (!canGenerate || isLoading) return

    onStart?.()
    setIsLoading(true)

    void (async () => {
      try {
        onSuccess(await onGenerate())
      } catch (error) {
        toastError(error, failureMessage)
      } finally {
        setIsLoading(false)
      }
    })()
  }, [canGenerate, isLoading, onGenerate, onSuccess, onStart, failureMessage])

  return { isLoading, run }
}
