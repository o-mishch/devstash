import type { ApiBody } from '@/types/api'

type FetchOptions = Omit<RequestInit, 'body'> & {
  body?: unknown
}

export async function apiFetch<T = null>(
  url: string,
  options: FetchOptions = {}
): Promise<ApiBody<T>> {
  const { body, headers, ...rest } = options

  const isJsonBody = body !== undefined && !(body instanceof FormData)

  try {
    const res = await fetch(url, {
      ...rest,
      headers: {
        ...(isJsonBody ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: isJsonBody ? JSON.stringify(body) : (body as BodyInit | undefined),
    })

    const contentType = res.headers.get('content-type')
    if (!contentType?.includes('application/json')) {
      await res.text() // Consume body to free resources
      return { status: 'internal_error', data: null, message: 'Server returned an invalid response format.' }
    }

    const data: ApiBody<T> = await res.json()
    return data
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network error. Please try again.'
    return { status: 'internal_error', data: null, message }
  }
}
