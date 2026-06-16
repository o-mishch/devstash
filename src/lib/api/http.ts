import { NextResponse } from 'next/server'
import { z } from 'zod'

// REST-native Response builders for the route handlers. [C] — pure (no session/db/redis), so route
// handlers and their tests can import it freely. Success returns the resource JSON with the right
// status; errors return `{ message }` (+ optional structured `data`) with the right status code.

export function json<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status })
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 })
}

export function problem(
  status: number,
  message: string,
  data?: unknown,
  headers?: Record<string, string>,
): NextResponse {
  return NextResponse.json(data === undefined ? { message } : { message, data }, { status, headers })
}

// Minimal failure descriptor a helper returns instead of throwing (e.g. the profile helpers or the
// AI orchestration's AiGenerationFailure): a status + human message, plus an
// optional `retryAfter` that becomes a `Retry-After` header on 429s. `problemFrom` maps it straight
// to a `problem` response so routes don't restate `problem(x.status, x.message, …)` at every site.
export interface FailureResult {
  status: number
  message: string
  retryAfter?: number
}

export function problemFrom(failure: FailureResult): NextResponse {
  return problem(
    failure.status,
    failure.message,
    undefined,
    failure.retryAfter ? { 'Retry-After': String(failure.retryAfter) } : undefined,
  )
}

export type ParseResult<T> = { ok: true; data: T } | { ok: false; res: NextResponse }

// Parse a value against a Zod schema; on failure return a 422 problem carrying a clean,
// human-readable message (z.prettifyError) plus the flattened field errors as `data`.
export function parseOr422<S extends z.ZodType>(schema: S, value: unknown): ParseResult<z.output<S>> {
  const result = schema.safeParse(value)
  if (result.success) return { ok: true, data: result.data }
  return { ok: false, res: problem(422, z.prettifyError(result.error), z.flattenError(result.error)) }
}
