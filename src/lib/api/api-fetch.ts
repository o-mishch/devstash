import axios from 'axios'
import type { Method } from 'axios'
import type { ApiBody } from '@/types/api'
import { toErrorMessage } from '@/lib/infra/logger'

type RequestOptions = {
  method?: Method
  body?: unknown
  headers?: Record<string, string>
  signal?: AbortSignal
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
  const { method = 'GET', body, headers, signal } = options

  try {
    const { data } = await axios.request<ApiBody<T>>({
      url,
      method,
      data: body,
      headers,
      signal,
    })
    return data
  } catch (err) {
    if (axios.isCancel(err)) {
      return { status: 'internal_error', data: null, message: null }
    }
    return handleApiError(err, 'Network error. Please try again.')
  }
}

// PUT a Blob/File directly to a presigned S3 URL, bypassing app auth headers.
export async function apiUpload(
  url: string,
  body: Blob | File,
  contentType: string,
  onProgress?: (percent: number) => void
): Promise<boolean> {
  try {
    await axios.put(url, body, {
      headers: { 'Content-Type': contentType },
      onUploadProgress: (e) => {
        if (onProgress && e.total) {
          onProgress(Math.round((e.loaded / e.total) * 100))
        }
      },
    })
    return true
  } catch {
    return false
  }
}
