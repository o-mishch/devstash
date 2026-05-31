import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { ApiResponse } from '@/lib/api'
import { createLogger } from '@/lib/logger'
import type { ApiBody } from '@/types/api'

const log = createLogger('session')

export async function getCurrentUserId(): Promise<string | null> {
  const session = await auth()
  return session?.user?.id ?? null
}

export async function requireUserId(): Promise<string> {
  const session = await auth()
  if (!session?.user?.id) notFound()
  return session.user.id
}

export async function withAuth<T>(
  fn: (userId: string) => Promise<ApiBody<T>>,
  context?: string
): Promise<ApiBody<T>> {
  const session = await auth()
  if (!session?.user?.id) return ApiResponse.UNAUTHORIZED('Not authenticated.') as ApiBody<T>
  try {
    return await fn(session.user.id)
  } catch (error) {
    log.error(`${context ?? 'action'} failed`, error)
    return ApiResponse.INTERNAL_ERROR() as ApiBody<T>
  }
}
