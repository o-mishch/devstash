import type { CollectionWithTypes } from './collection'
import type { SidebarItemType } from './item'

export interface SidebarUser {
  name: string | null
  email: string | null
  image: string | null
}

export interface SidebarData {
  collections: CollectionWithTypes[]
  itemTypes: SidebarItemType[]
  user: SidebarUser | null
}
