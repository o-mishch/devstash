'use client'

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { safe } from '@orpc/client'

type SubmitFn<T> = (body: Record<string, string>) => Promise<T>

interface Options<T> {
  onSuccess?: (data: T) => void
  fallbackError?: string
}

/**
 * Lets a `<form action={formAction}>` submit its fields to an oRPC procedure (which throws an
 * ORPCError on failure), toasting `error.message` on error and running `onSuccess` with the
 * resolved data on success.
 */
export function useOrpcFormAction<T>(submit: SubmitFn<T>, options: Options<T> = {}) {
  const { onSuccess, fallbackError = 'Something went wrong. Please try again.' } = options
  const [isPending, setIsPending] = useState(false)

  const formAction = useCallback(async (formData: FormData) => {
    const body = Object.fromEntries(
      Array.from(formData.entries(), ([key, value]) => [key, String(value)]),
    )
    setIsPending(true)
    const { error, data } = await safe(submit(body))
    setIsPending(false)

    if (!error) {
      onSuccess?.(data)
    } else {
      toast.error(error.message || fallbackError)
    }
  }, [submit, onSuccess, fallbackError])

  return { formAction, isPending }
}
