import { toast } from 'sonner'
import { hasText } from '@/lib/utils'

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null
}

/**
 * Human-readable message from a Hey API error. The backend speaks RFC 9457
 * problem+json; Hey API throws the parsed body. Prefer a field-level validation
 * message, then `detail`, then `title`, then the caller's fallback.
 */
export function apiErrorMessage(
  error: unknown,
  fallback = 'Something went wrong. Please try again.',
): string {
  if (isObject(error)) {
    if ('errors' in error && Array.isArray(error['errors'])) {
      const firstError = error['errors'].find(
        (e: unknown): e is Record<string, unknown> =>
          isObject(e) &&
          'message' in e &&
          typeof e['message'] === 'string' &&
          hasText(e['message']),
      )
      if (firstError !== undefined) {
        const msg = firstError['message']
        if (typeof msg === 'string') return msg
      }
    }
    if ('detail' in error && typeof error['detail'] === 'string' && hasText(error['detail'])) {
      return error['detail']
    }
    if ('title' in error && typeof error['title'] === 'string' && hasText(error['title'])) {
      return error['title']
    }
  }
  if (error instanceof Error) return error.message
  return fallback
}

/**
 * HTTP status from a Hey API error — the backend speaks RFC 9457, whose problem document
 * carries `status`. Callers need this to branch on the KIND of failure: a boolean
 * `isError` cannot tell "this resource is genuinely gone" (404) from "the API hiccuped"
 * (5xx/network), and stating the first when it was the second is a false claim about the
 * user's data.
 */
export function apiErrorStatus(error: unknown): number | undefined {
  if (isObject(error) && typeof error['status'] === 'number') return error['status']
  return undefined
}

/**
 * The default mutation `onError`: surface the API message as an error toast. One owner for the
 * "a mutation failed" UX, so every `useMutation` reads `onError: toastMutationError` instead of
 * re-inlining the same `toast.error(apiErrorMessage(...))` — a flow that guards a status first
 * (e.g. use-logout's 401) stays separate on purpose.
 */
export function toastMutationError(error: unknown): void {
  toast.error(apiErrorMessage(error))
}
