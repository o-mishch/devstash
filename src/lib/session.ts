import 'server-only'

import { cache } from 'react'
import { notFound, unstable_rethrow } from 'next/navigation'
import { auth } from '@/auth'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'session' })

export async function getSession() {
  try {
    return await auth()
  } catch (error) {
    // Preserve all current and future Next.js control-flow errors before treating an
    // auth exception as recoverable. Do not replace this with a digest allowlist.
    unstable_rethrow(error)
    log.warn({ err: error }, 'Failed to read auth session')
    return null
  }
}

/** Request-scoped session — deduplicates auth reads within a single server render. */
export const getCachedSession = cache(getSession)

export async function getCurrentUserId(): Promise<string | null> {
  const session = await getCachedSession()
  return session?.user?.id ?? null
}

export async function requireUserId(): Promise<string> {
  const session = await getCachedSession()
  if (!session?.user?.id) notFound()
  return session.user.id
}

export interface SessionContext {
  userId: string
  isPro: boolean
}
