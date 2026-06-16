import { useState, useCallback, startTransition } from 'react'
import { toast } from 'sonner'

interface UseOptimisticToggleOptions {
  onSuccess?: (next: boolean) => void
  errorLabel?: string
}

/**
 * Optimistic boolean toggle. `action` resolves on success and throws on failure
 * (transport-agnostic — callers throw `new Error(message)` so the message is surfaced via toast).
 */
export function useOptimisticToggle(
  initial: boolean,
  action: (next: boolean) => Promise<unknown>,
  options?: UseOptimisticToggleOptions,
) {
  const [optimistic, setOptimistic] = useState<boolean | null>(null)
  const value = optimistic ?? initial

  const toggle = useCallback(() => {
    const next = !value
    setOptimistic(next)

    startTransition(async () => {
      try {
        await action(next)
        options?.onSuccess?.(next)
      } catch (error) {
        setOptimistic(!next)
        toast.error(error instanceof Error ? error.message : (options?.errorLabel ?? 'Action failed'))
      }
    })
  }, [value, action, options])

  return { value, toggle }
}
