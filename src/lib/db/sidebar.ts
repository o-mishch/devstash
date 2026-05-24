import { cache } from 'react'
import { auth } from '@/auth'
import { getAllCollections, type CollectionWithTypes } from './collections'
import { getSidebarItemTypes, type SidebarItemType } from './items'

interface SidebarUser {
  name: string | null
  email: string | null
  image: string | null
}

export interface SidebarData {
  collections: CollectionWithTypes[]
  itemTypes: SidebarItemType[]
  user: SidebarUser | null
}

export const getSidebarData = cache(async (): Promise<SidebarData> => {
  const session = await auth()
  const userId = session?.user?.id ?? null

  const [collections, itemTypes] = await Promise.all([
    userId ? getAllCollections(userId) : Promise.resolve([]),
    getSidebarItemTypes(userId),
  ])

  return {
    collections,
    itemTypes,
    user: session?.user
      ? { name: session.user.name ?? null, email: session.user.email ?? null, image: session.user.image ?? null }
      : null,
  }
})
