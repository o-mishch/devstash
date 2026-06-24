import type { CollectionWithTypes } from './collection'
import type { SidebarItemType } from './item'

export interface SidebarUser {
  id: string
  name: string | null
  email: string | null
  image: string | null
  isPro: boolean
}

export interface SidebarData {
  // Full collections (not the slim SidebarCollection) so the sidebars can seed the shared `/collections`
  // TanStack cache with complete rows (types + createdAt) — the grid/detail readers share that key.
  collections: CollectionWithTypes[]
  itemTypes: SidebarItemType[]
  user: SidebarUser | null
}
