'use client'

import { useActionState, useEffect } from 'react'
import { toast } from 'sonner'
import type { ApiBody } from '@/types/api'

type ActionFn<T> = (prev: ApiBody<T> | null, data: FormData) => Promise<ApiBody<T>>

interface Options<T> {
  onSuccess?: (state: ApiBody<T>) => void
  fallbackError?: string
}

export function useActionStateWithToast<T = null>(
  action: ActionFn<T>,
  options: Options<T> = {}
) {
  const { onSuccess, fallbackError = 'Something went wrong. Please try again.' } = options
  const [state, formAction, isPending] = useActionState(action, null)

  useEffect(() => {
    if (!state) return
    if (state.status === 'ok') {
      onSuccess?.(state)
    } else {
      toast.error(state.message ?? fallbackError)
    }
  }, [state, onSuccess, fallbackError])

  return { state, formAction, isPending }
}
