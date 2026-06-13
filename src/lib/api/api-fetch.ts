import axios from 'axios'
import type { Method } from 'axios'
import type { ApiBody } from '@/types/api'
import { toErrorMessage } from '@/lib/infra/logger'

export interface RequestOptions {
  body?: unknown
  headers?: Record<string, string>
  signal?: AbortSignal
  // For uploads to external storage (S3 presigned URLs) — not used for app API routes.
  onProgress?: (percent: number) => void
}

function handleApiError<T>(err: unknown, fallbackMessage: string): ApiBody<T> {
  if (axios.isAxiosError(err) && err.response) {
    const body = err.response.data as ApiBody<T>
    if (body && typeof body.status === 'string') return body
  }
  const message = toErrorMessage(err, fallbackMessage)
  return { status: 'internal_error', data: null, message }
}

export function get<T = null>(url: string, options?: RequestOptions): Promise<ApiBody<T>> {
  return apiRequest<T>('GET', url, options)
}

export function post<T = null>(url: string, body?: unknown, options?: Omit<RequestOptions, 'body'>): Promise<ApiBody<T>> {
  return apiRequest<T>('POST', url, { ...options, body })
}

export function put<T = null>(url: string, body?: unknown, options?: Omit<RequestOptions, 'body'>): Promise<ApiBody<T>> {
  return apiRequest<T>('PUT', url, { ...options, body })
}

// `delete` is a reserved word — export as `del`.
export function del<T = null>(url: string, options?: RequestOptions): Promise<ApiBody<T>> {
  return apiRequest<T>('DELETE', url, options)
}

async function apiRequest<T = null>(method: Method, url: string, options: RequestOptions = {}): Promise<ApiBody<T>> {
  const { body, headers, signal, onProgress } = options
  try {
    const res = await axios.request<ApiBody<T>>({
      url,
      method,
      data: body,
      headers,
      signal,
      onUploadProgress: onProgress
        ? (e) => { if (e.total) onProgress(Math.round((e.loaded / e.total) * 100)) }
        : undefined,
    })
    // 204 No Content (e.g. S3 presigned POST/PUT success) — no body, treat as ok.
    if (!res.data) return { status: 'ok', data: null, message: null }
    return res.data
  } catch (err) {
    if (axios.isCancel(err)) return { status: 'internal_error', data: null, message: null }
    return handleApiError(err, 'Network error. Please try again.')
  }
}
