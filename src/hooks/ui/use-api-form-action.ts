'use client'

import { useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toastError } from '@/lib/dom/toast-error'

type SubmitFn<T> = (body: Record<string, string>) => Promise<T>

interface Options<T> {
  onSuccess?: (data: T) => void
  fallbackError?: string
}

/**
 * Lets a `<form action={formAction}>` submit its fields to an async `submit` function that throws
 * an `Error` on failure (the `api`/`openapi-fetch` call sites throw `new Error(error.message)`).
 * Backed by `useMutation`: the submit is the mutationFn (throws → onError), `onError` toasts the message,
 * `onSuccess` runs the caller's callback with the resolved data, and `isPending` comes from the mutation.
 */
export function useApiFormAction<T>(submit: SubmitFn<T>, options: Options<T> = {}) {
  const { onSuccess, fallbackError = 'Something went wrong. Please try again.' } = options

  const { mutateAsync, isPending } = useMutation({
    mutationFn: (body: Record<string, string>) => submit(body),
    onSuccess: (data) => onSuccess?.(data),
    onError: (error) => toastError(error, fallbackError),
  })

  const formAction = useCallback(
    async (formData: FormData) => {
      const body = Object.fromEntries(
        Array.from(formData.entries(), ([key, value]) => [key, String(value)]),
      )
      // onError already toasted — swallow the rejection so the form action itself never rejects.
      try {
        await mutateAsync(body)
      } catch {
        /* handled in onError */
      }
    },
    [mutateAsync],
  )

  return { formAction, isPending }
}
