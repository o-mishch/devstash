'use client'

import { useActionState, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import type { ActionState } from '@/types/actions'

type ActionFn<T> = (prev: ActionState<T> | null, data: FormData) => Promise<ActionState<T>>

interface Options<T> {
  onSuccess?: (state: ActionState<T>) => void
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
  useEffect(() => { onSuccessRef.current = onSuccess; fallbackErrorRef.current = fallbackError })

  useEffect(() => {
    if (!state) return
    if (state.success) {
      onSuccessRef.current?.(state)
    } else {
      toast.error(state.message ?? fallbackErrorRef.current)
    }
  }, [state])

  return { state, formAction, isPending }
}
