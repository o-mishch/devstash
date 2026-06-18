'use client'

import { useState, useCallback } from 'react'
import { toastError } from '@/lib/utils/toast-error'

type SubmitFn<T> = (body: Record<string, string>) => Promise<T>

interface Options<T> {
  onSuccess?: (data: T) => void
  fallbackError?: string
}

/**
 * Lets a `<form action={formAction}>` submit its fields to an async `submit` function that throws
 * an `Error` on failure (the `api`/`openapi-fetch` call sites throw `new Error(error.message)`).
 * Toasts the error message on failure and runs `onSuccess` with the resolved data on success.
 */
export function useApiFormAction<T>(submit: SubmitFn<T>, options: Options<T> = {}) {
  const { onSuccess, fallbackError = 'Something went wrong. Please try again.' } = options
  const [isPending, setIsPending] = useState(false)

  const formAction = useCallback(async (formData: FormData) => {
    const body = Object.fromEntries(
      Array.from(formData.entries(), ([key, value]) => [key, String(value)]),
    )
    setIsPending(true)
    try {
      const data = await submit(body)
      onSuccess?.(data)
    } catch (error) {
      toastError(error, fallbackError)
    } finally {
      setIsPending(false)
    }
  }, [submit, onSuccess, fallbackError])

  return { formAction, isPending }
}
