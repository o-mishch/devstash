import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { OpenAPIReferencePlugin } from '@orpc/openapi/plugins'
import { ResponseHeadersPlugin } from '@orpc/server/plugins'
import { onError, ORPCError, ValidationError } from '@orpc/server'
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4'
import { z } from 'zod'
import { router } from '@/lib/api/router'
import { logger } from '@/lib/infra/pino'
import { getCachedSession } from '@/lib/session'

const log = logger.child({ tag: 'api' })

// Dev-only Swagger UI + OpenAPI spec, served by the same handler. Never registered in
// production, so /api/docs and /api/spec.json fall through to the router and 404 there.
const isDev = process.env.NODE_ENV !== 'production'

// The docs/spec routes are served by the plugin before any procedure runs, so they bypass
// the per-procedure `authed` middleware. Gate them on a session so the full API contract is
// never readable unauthenticated — even on a non-localhost dev/preview host.
const DOCS_PATHS = new Set(['/api/docs', '/api/spec.json'])

const handler = new OpenAPIHandler(router, {
  // ResponseHeadersPlugin injects `context.resHeaders` so handlers/middleware can set response
  // headers (e.g. `Retry-After` on 429). Always on; Swagger UI is dev-only.
  plugins: [
    new ResponseHeadersPlugin(),
    ...(isDev
      ? [
          new OpenAPIReferencePlugin({
            docsProvider: 'swagger',
            docsPath: '/docs',
            specPath: '/spec.json',
            schemaConverters: [new ZodToJsonSchemaConverter()],
            specGenerateOptions: { info: { title: 'DevStash API', version: '1.0.0' } },
          }),
        ]
      : []),
  ],
  interceptors: [
    onError((error) => {
      // Only genuine failures are error-level. Routine ORPCErrors (UNAUTHORIZED / FORBIDDEN /
      // NOT_FOUND / BAD_REQUEST / TOO_MANY_REQUESTS) are expected control flow, not noise.
      if (!(error instanceof ORPCError) || error.code === 'INTERNAL_SERVER_ERROR') {
        log.error({ err: error }, 'orpc handler error')
      }
    }),
  ],
  clientInterceptors: [
    onError((error) => {
      // Preserve the legacy validation_error → 422 with a clean, human-readable message.
      // oRPC's automatic input validation throws BAD_REQUEST (400) by default.
      if (error instanceof ORPCError && error.code === 'BAD_REQUEST' && error.cause instanceof ValidationError) {
        const zodError = new z.ZodError(error.cause.issues as z.core.$ZodIssue[])
        throw new ORPCError('INPUT_VALIDATION_FAILED', {
          status: 422,
          message: z.prettifyError(zodError),
          data: z.flattenError(zodError),
          cause: error.cause,
        })
      }
    }),
  ],
})

async function handle(request: Request) {
  if (isDev && DOCS_PATHS.has(new URL(request.url).pathname)) {
    const session = await getCachedSession()
    if (!session?.user?.id) return new Response('Not found', { status: 404 })
  }

  // `authed` middleware resolves the session lazily per request, so the initial context is empty.
  const { matched, response } = await handler.handle(request, { prefix: '/api', context: {} })
  if (matched) return response
  return new Response('Not found', { status: 404 })
}

export const GET = handle
export const POST = handle
export const PUT = handle
export const PATCH = handle
export const DELETE = handle

// Runs on the Node.js runtime (the route-handler default) — the handler + middleware import
// server-only infra (Prisma, session, redis). Never opt this route into the Edge runtime.
// (An explicit `export const runtime` is incompatible with cacheComponents; the default is Node.)
