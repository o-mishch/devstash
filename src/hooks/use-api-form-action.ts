'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import type { ApiBody } from '@/types/api'

type SubmitFn<T> = (body: Record<string, string>) => Promise<ApiBody<T>>

interface Options<T> {
  onSuccess?: (state: ApiBody<T>) => void
  fallbackError?: string
}

/**
 * apiFetch equivalent of `useActionStateWithToast` — lets a `<form action={formAction}>`
 * submit its fields as a JSON body to a REST route, toasting on error and running `onSuccess` on ok.
 */
export function useApiFormAction<T = null>(submit: SubmitFn<T>, options: Options<T> = {}) {
  const { onSuccess, fallbackError = 'Something went wrong. Please try again.' } = options
  const [isPending, setIsPending] = useState(false)

  const submitRef = useRef(submit)
  const onSuccessRef = useRef(onSuccess)
  const fallbackErrorRef = useRef(fallbackError)
  useEffect(() => { submitRef.current = submit })
  useEffect(() => { onSuccessRef.current = onSuccess })
  useEffect(() => { fallbackErrorRef.current = fallbackError })

  const formAction = useCallback(async (formData: FormData) => {
    const body = Object.fromEntries(
      Array.from(formData.entries(), ([key, value]) => [key, String(value)]),
    )
    setIsPending(true)
    const result = await submitRef.current(body)
    setIsPending(false)

    if (result.status === 'ok' || result.status === 'created') {
      onSuccessRef.current?.(result)
    } else {
      toast.error(result.message ?? fallbackErrorRef.current)
    }
  }, [])

  return { formAction, isPending }
}
