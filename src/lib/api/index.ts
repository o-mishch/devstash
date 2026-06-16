import { NextRequest, NextResponse } from 'next/server'
import { getCachedSession, type SessionContext } from '@/lib/session'
import { logger } from '@/lib/infra/pino'
import { ApiResponse } from '@/lib/api/api-response'
import { ErrorMessage } from '@/lib/api/error-messages'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'
import type { ApiStatus, ApiBody } from '@/types/api'

export { ApiResponse } from '@/lib/api/api-response'

const log = logger.child({ tag: 'api' })

const HTTP_STATUS: Record<ApiStatus, number> = {
  ok: 200,
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
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
  authCtx: SessionContext
) => Promise<HandlerResult>

/** Redirect from an `apiRoute` handler — prefer over raw `NextResponse.redirect`. */
export function apiRedirect(url: string | URL, status?: number): Response {
  return NextResponse.redirect(url, status)
}

export function authenticatedRoute(handler: AuthenticatedHandler) {
  return apiRoute(async (request, context) => {
    const session = await getCachedSession()
    if (!session?.user?.id) return ApiResponse.UNAUTHORIZED(ErrorMessage.NOT_AUTHENTICATED)
    const isPro = await getCachedVerifiedProAccess(session.user.id)
    return handler(request, context, { userId: session.user.id, isPro })
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
      log.error({ err }, 'unhandled route error')
      return toNextResponse(ApiResponse.INTERNAL_ERROR())
    }
  }
}
