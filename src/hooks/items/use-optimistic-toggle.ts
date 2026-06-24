'use client'

import { useCallback, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'

interface UseOptimisticToggleOptions {
  onSuccess?: (next: boolean) => void
  errorLabel?: string
}

/**
 * Optimistic boolean toggle, backed by `useMutation`. `action` resolves on success and throws on failure
 * (transport-agnostic — callers throw `new Error(message)` so the message is surfaced via toast).
 *
 * The displayed `value` is held in local state (not derived from `mutation.isPending`/`variables`) because
 * it must PERSIST after success — the optimistic flip stays applied until the parent re-renders with fresh
 * data. `onMutate` applies the flip, `onError` reverts it, `onSuccess` keeps it and notifies the caller.
 */
export function useOptimisticToggle(
  initial: boolean,
  action: (next: boolean) => Promise<unknown>,
  options?: UseOptimisticToggleOptions,
) {
  const [optimistic, setOptimistic] = useState<boolean | null>(null)
  const value = optimistic ?? initial

  const mutation = useMutation({
    mutationFn: (next: boolean) => action(next),
    onMutate: (next: boolean) => setOptimistic(next),
    onSuccess: (_data, next) => options?.onSuccess?.(next),
    onError: (error: unknown, next) => {
      setOptimistic(!next)
      toast.error(error instanceof Error ? error.message : (options?.errorLabel ?? 'Action failed'))
    },
  })

  const toggle = useCallback(() => mutation.mutate(!value), [mutation, value])

  return { value, toggle }
}
