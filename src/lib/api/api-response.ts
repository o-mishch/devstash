import type { ApiStatus, ApiBody } from '@/types/api'

function makeBuilder(status: ApiStatus) {
  function builder(): ApiBody<null>
  function builder(message: string): ApiBody<null>
  function builder<T extends object>(data: T, message?: string | null): ApiBody<T>
  function builder<T extends object>(
    dataOrMessage?: T | string | null,
    message?: string | null
  ): ApiBody<T | null> {
    if (typeof dataOrMessage === 'string') {
      return { status, data: null, message: dataOrMessage }
    }
    const result: ApiBody<T | null> = { status, data: dataOrMessage ?? null }
    if (message != null) result.message = message
    return result
  }
  return builder
}

export const ApiResponse = {
  OK: makeBuilder('ok'),
  BAD_REQUEST: makeBuilder('bad_request'),
  UNAUTHORIZED: makeBuilder('unauthorized'),
  FORBIDDEN: makeBuilder('forbidden'),
  NOT_FOUND: makeBuilder('not_found'),
  TOO_MANY_REQUESTS: makeBuilder('too_many_requests'),
  INTERNAL_ERROR: makeBuilder('internal_error'),
}
