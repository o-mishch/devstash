import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { createLogger } from '@/lib/logger'
import type { ApiStatus, ApiBody } from '@/types/api'

const log = createLogger('api')

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

interface ApiBodyWithHeaders<T> {
  body: ApiBody<T>
  headers: Record<string, string>
}

type HandlerResult = ApiBody<unknown> | ApiBodyWithHeaders<unknown> | Response

function isWithHeaders(result: HandlerResult): result is ApiBodyWithHeaders<unknown> {
  return !(result instanceof Response) && 'body' in result && 'headers' in result
}

function isRawResponse(result: HandlerResult): result is Response {
  return result instanceof Response
}

function toNextResponse<T>(body: ApiBody<T>, headers?: Record<string, string>): NextResponse<ApiBody<T>> {
  return NextResponse.json(body, { status: HTTP_STATUS[body.status], headers })
}

export interface RouteContext {
  params: Promise<Record<string, string>>
}

type AuthenticatedHandler = (
  request: NextRequest,
  context: RouteContext,
  userId: string
) => Promise<HandlerResult>

export function authenticatedRoute(handler: AuthenticatedHandler) {
  return apiRoute(async (request, context) => {
    const session = await auth()
    if (!session?.user?.id) return ApiResponse.UNAUTHORIZED('Not authenticated.')
    return handler(request, context, session.user.id)
  })
}

export function apiRoute(
  handler: (request: NextRequest, context: RouteContext) => Promise<HandlerResult>
): (request: NextRequest, context: RouteContext) => Promise<NextResponse | Response> {
  return async (request, context) => {
    try {
      const result = await handler(request, context)
      if (isRawResponse(result)) return result
      if (isWithHeaders(result)) return toNextResponse(result.body, result.headers)
      return toNextResponse(result)
    } catch (err) {
      log.error('unhandled route error', err)
      return toNextResponse(ApiResponse.INTERNAL_ERROR())
    }
  }
}

