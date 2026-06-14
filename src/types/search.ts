import type { SearchResultItem } from '@/types/item'
import type { SidebarCollection } from '@/types/collection'

export interface SearchResult {
  items: SearchResultItem[]
  collections: SidebarCollection[]
}
