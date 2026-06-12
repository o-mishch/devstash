'use client'

import { usePathname } from 'next/navigation'
import { CreateItemDialog } from '@/components/items/item-create-dialog'
import { getInitialTypeFromPathname, getCollectionIdFromPathname } from '@/lib/utils/url'
import type { SidebarItemType } from '@/types/item'
import type { CollectionPickerItem } from '@/types/collection'

interface TopbarCreateButtonProps {
  itemTypes: SidebarItemType[]
  collections: CollectionPickerItem[]
}

export function TopbarCreateButton({ itemTypes, collections }: TopbarCreateButtonProps) {
  const pathname = usePathname()
  const initialType = getInitialTypeFromPathname(pathname, itemTypes)
  const initialCollectionId = getCollectionIdFromPathname(pathname)

  return (
    <CreateItemDialog
      itemTypes={itemTypes}
      collections={collections}
      initialType={initialType}
      initialCollectionId={initialCollectionId}
    />
  )
}
