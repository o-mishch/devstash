import { NextRequest, NextResponse } from 'next/server'
import type { ApiStatus, ApiBody } from '@/types/api'

export type { ApiStatus, ApiBody }

const HTTP_STATUS: Record<ApiStatus, number> = {
  ok: 200,
  created: 201,
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  validation_error: 422,
  too_many_requests: 429,
  internal_error: 500,
}

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
    return { status, data: dataOrMessage ?? null, message: message ?? null }
  }
  return builder
}

export const ApiResponse = {
  OK: makeBuilder('ok'),
  CREATED: makeBuilder('created'),
  BAD_REQUEST: makeBuilder('bad_request'),
  UNAUTHORIZED: makeBuilder('unauthorized'),
  FORBIDDEN: makeBuilder('forbidden'),
  NOT_FOUND: makeBuilder('not_found'),
  CONFLICT: makeBuilder('conflict'),
  VALIDATION_ERROR: makeBuilder('validation_error'),
  TOO_MANY_REQUESTS: makeBuilder('too_many_requests'),
  INTERNAL_ERROR: makeBuilder('internal_error'),
}

function toNextResponse<T>(body: ApiBody<T>): NextResponse<ApiBody<T>> {
  return NextResponse.json(body, { status: HTTP_STATUS[body.status] })
}

export function apiRoute(
  handler: (request: NextRequest) => Promise<ApiBody<unknown>>
): (request: NextRequest) => Promise<NextResponse> {
  return async (request) => {
    try {
      return toNextResponse(await handler(request))
    } catch {
      return toNextResponse(ApiResponse.INTERNAL_ERROR())
    }
  }
}
