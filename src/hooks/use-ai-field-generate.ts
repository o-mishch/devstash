'use client'

import { useState, useCallback } from 'react'
import { toastError } from '@/lib/utils/toast-error'

interface UseAiFieldGenerateParams<T> {
  canGenerate: boolean
  onGenerate: () => Promise<T>
  onSuccess: (data: T) => void
  onStart?: () => void
  failureMessage: string
}

interface UseAiFieldGenerateResult {
  isLoading: boolean
  run: () => Promise<void>
}

export function useAiFieldGenerate<T>({
  canGenerate,
  onGenerate,
  onSuccess,
  onStart,
  failureMessage,
}: UseAiFieldGenerateParams<T>): UseAiFieldGenerateResult {
  const [isLoading, setIsLoading] = useState(false)

  const run = useCallback(async () => {
    if (!canGenerate) return

    onStart?.()
    setIsLoading(true)

    try {
      onSuccess(await onGenerate())
    } catch (error) {
      toastError(error, failureMessage)
    } finally {
      setIsLoading(false)
    }
  }, [canGenerate, onGenerate, onSuccess, onStart, failureMessage])

  return { isLoading, run }
}
