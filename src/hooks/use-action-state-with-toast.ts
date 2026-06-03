'use client'

import { useActionState, useEffect, useRef } from 'react'
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

  const onSuccessRef = useRef(onSuccess)
  const fallbackErrorRef = useRef(fallbackError)
  useEffect(() => { onSuccessRef.current = onSuccess })
  useEffect(() => { fallbackErrorRef.current = fallbackError })

  useEffect(() => {
    if (!state) return
    if (state.status === 'ok') {
      onSuccessRef.current?.(state)
    } else {
      toast.error(state.message ?? fallbackErrorRef.current)
    }
  }, [state])

  return { state, formAction, isPending }
}
