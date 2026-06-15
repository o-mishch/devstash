'use client'

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { safe } from '@orpc/client'

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

    const { error, data } = await safe(onGenerate())
    if (!error) {
      onSuccess(data)
    } else {
      toast.error(error.message || failureMessage)
    }
    setIsLoading(false)
  }, [canGenerate, onGenerate, onSuccess, onStart, failureMessage])

  return { isLoading, run }
}
