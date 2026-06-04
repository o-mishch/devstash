import { useState, useCallback, startTransition } from 'react'
import { toast } from 'sonner'
import type { ApiBody } from '@/types/api'

export function useOptimisticToggle(
  initial: boolean,
  action: (next: boolean) => Promise<ApiBody<unknown>>,
  options?: {
    onSuccess?: (next: boolean) => void
    errorLabel?: string
  }
) {
  const [optimistic, setOptimistic] = useState<boolean | null>(null)
  const value = optimistic ?? initial

  const toggle = useCallback(() => {
    const next = !value
    setOptimistic(next)

    startTransition(async () => {
      const result = await action(next)
      if (result.status === 'ok') {
        options?.onSuccess?.(next)
      } else {
        setOptimistic(!next)
        toast.error(result.message ?? options?.errorLabel ?? 'Action failed')
      }
    })
  }, [value, action, options])

  return { value, toggle }
}
