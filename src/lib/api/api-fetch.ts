import axios from 'axios'
import type { Method } from 'axios'
import type { ApiBody } from '@/types/api'
import { toErrorMessage } from '@/lib/infra/logger'

type RequestOptions = {
  method?: Method
  body?: unknown
  headers?: Record<string, string>
}

function handleApiError<T>(err: unknown, fallbackMessage: string): ApiBody<T> {
  if (axios.isAxiosError(err) && err.response) {
    const body = err.response.data as ApiBody<T>
    if (body && typeof body.status === 'string') return body
  }
  const message = toErrorMessage(err, fallbackMessage)
  return { status: 'internal_error', data: null, message }
}

export async function apiFetch<T = null>(
  url: string,
  options: RequestOptions = {}
): Promise<ApiBody<T>> {
  const { method = 'GET', body, headers } = options

  try {
    const { data } = await axios.request<ApiBody<T>>({
      url,
      method,
      data: body,
      headers,
    })
    return data
  } catch (err) {
    return handleApiError(err, 'Network error. Please try again.')
  }
}

export async function apiUpload<T = null>(
  url: string,
  formData: FormData,
  onProgress?: (percent: number) => void
): Promise<ApiBody<T>> {
  try {
    const { data } = await axios.post<ApiBody<T>>(url, formData, {
      onUploadProgress: (e) => {
        if (onProgress && e.total) {
          onProgress(Math.round((e.loaded / e.total) * 100))
        }
      },
    })
    return data
  } catch (err) {
    return handleApiError(err, 'Upload failed. Please try again.')
  }
}
