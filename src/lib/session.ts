import { auth } from '@/auth'
import { ApiResponse } from '@/lib/api'
import type { ApiBody } from '@/types/api'

export async function getCurrentUserId(): Promise<string | null> {
  const session = await auth()
  return session?.user?.id ?? null
}

export async function withAuth<T>(
  fn: (userId: string) => Promise<ApiBody<T>>
): Promise<ApiBody<T>> {
  const session = await auth()
  if (!session?.user?.id) return ApiResponse.UNAUTHORIZED('Not authenticated.') as ApiBody<T>
  return fn(session.user.id)
}
