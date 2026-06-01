import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { ApiResponse } from '@/lib/api-response'
import { createLogger } from '@/lib/logger'
import { z } from 'zod'
import { parseOrFail } from '@/lib/utils/validators'
import type { ApiBody } from '@/types/api'

const log = createLogger('session')

export async function getSession() {
  try {
    return await auth()
  } catch {
    return null
  }
}

export async function getCurrentUserId(): Promise<string | null> {
  const session = await getSession()
  return session?.user?.id ?? null
}

export async function requireUserId(): Promise<string> {
  const session = await getSession()
  if (!session?.user?.id) notFound()
  return session.user.id
}

export async function withAuth<T>(
  fn: (userId: string) => Promise<ApiBody<T>>,
  context?: string
): Promise<ApiBody<T>> {
  const session = await getSession()
  if (!session?.user?.id) return ApiResponse.UNAUTHORIZED('Not authenticated.') as ApiBody<T>
  try {
    return await fn(session.user.id)
  } catch (error) {
    log.error(`${context ?? 'action'} failed`, error)
    return ApiResponse.INTERNAL_ERROR() as ApiBody<T>
  }
}

export async function withValidatedAuth<T, Output>(
  schema: z.ZodType<Output>,
  raw: unknown,
  fn: (userId: string, data: Output) => Promise<ApiBody<T>>,
  context?: string
): Promise<ApiBody<T>> {
  return withAuth(async (userId) => {
    const result = parseOrFail<Output>(schema, raw)
    if (!result.success) return result.response as ApiBody<T>
    return await fn(userId, result.data)
  }, context)
}
