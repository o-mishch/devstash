import { cache } from 'react'
import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { logger } from '@/lib/infra/pino'
import { isPrerenderInterrupt } from '@/lib/utils/url'

const log = logger.child({ tag: 'session' })

export async function getSession() {
  try {
    return await auth()
  } catch (error) {
    // Rethrow the prerender-abort signal so React/Next.js can handle it instead
    // of swallowing and miscategorizing it as an auth failure.
    if (isPrerenderInterrupt(error)) throw error
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
