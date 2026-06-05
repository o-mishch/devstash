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
  collections: CollectionWithTypes[]
  itemTypes: SidebarItemType[]
  user: SidebarUser | null
}
