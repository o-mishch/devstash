import { getAllCollections } from './collections'
import { getSidebarItemTypes } from './items'
import type { SidebarData, SidebarUser } from '@/types/sidebar'

export async function fetchSidebarData(
  userId: string | null,
  user: SidebarUser | null
): Promise<SidebarData> {
  const [collections, itemTypes] = await Promise.all([
    userId ? getAllCollections(userId) : Promise.resolve([]),
    getSidebarItemTypes(userId),
  ])
  return { collections, itemTypes, user }
}
