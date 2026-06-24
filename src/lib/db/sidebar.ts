import 'server-only'

import { getAllCollections } from './collections'
import { getSidebarItemTypes } from './items'
import { logger } from '@/lib/infra/pino'
import { cache } from 'react'
import type { SidebarData, SidebarUser } from '@/types/sidebar'

const log = logger.child({ tag: 'sidebar' })

const EMPTY_SIDEBAR: Omit<SidebarData, 'user'> = { collections: [], itemTypes: [] }

const fetchSidebarDataInternal = cache(async (userId: string | null) => {
  const [collections, itemTypes] = await Promise.all([
    userId ? getAllCollections(userId) : Promise.resolve([]),
    getSidebarItemTypes(userId),
  ])
  return { collections, itemTypes }
})

export async function fetchSidebarData(
  user: SidebarUser | null
): Promise<SidebarData> {
  try {
    const userId = user?.id ?? null
    const { collections, itemTypes } = await fetchSidebarDataInternal(userId)
    return { collections, itemTypes, user }
  } catch (error) {
    log.error({ err: error }, 'DB: fetchSidebarData failed, returning empty sidebar')
    return { ...EMPTY_SIDEBAR, user }
  }
}
