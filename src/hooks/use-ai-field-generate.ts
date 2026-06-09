'use client'

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import type { ApiBody } from '@/types/api'

interface UseAiFieldGenerateParams<T> {
  canGenerate: boolean
  onGenerate: () => Promise<ApiBody<T | null>>
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
      const response = await onGenerate()
      if (response.status === 'ok' && response.data != null) {
        onSuccess(response.data)
      } else {
        toast.error(response.message || failureMessage)
      }
    } catch {
      toast.error('An unexpected error occurred.')
    } finally {
      setIsLoading(false)
    }
  }, [canGenerate, onGenerate, onSuccess, onStart, failureMessage])

  return { isLoading, run }
}
