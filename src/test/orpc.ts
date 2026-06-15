import { call, ORPCError } from '@orpc/server'
import { expect } from 'vitest'

// Shared oRPC test harness. `call` runs the full procedure (auth middleware + input/output
// validation + handler) with an empty initial context, matching the OpenAPI handler (which
// resolves the session in middleware). Public procedures simply ignore the empty context.
type Procedure = Parameters<typeof call>[0]

export function invoke<I>(procedure: Procedure, input: I) {
  return call(procedure, input, { context: {} })
}

export async function expectORPCError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(ORPCError)
  await promise.catch((error) => expect((error as ORPCError<string, unknown>).code).toBe(code))
}
