import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/session'
import { createLogger } from '@/lib/logger'
import { ApiResponse } from '@/lib/api-response'
import type { ApiStatus, ApiBody } from '@/types/api'

export { ApiResponse } from '@/lib/api-response'

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
    const userId = await getCurrentUserId()
    if (!userId) return ApiResponse.UNAUTHORIZED('Not authenticated.')
    return handler(request, context, userId)
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

