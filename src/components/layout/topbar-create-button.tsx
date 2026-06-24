'use client'

import { usePathname } from 'next/navigation'
import { CreateItemDialog } from '@/components/items/item-create-dialog'
import { getInitialTypeFromPathname, getCollectionIdFromPathname } from '@/lib/utils/url'
import type { SidebarItemType } from '@/types/item'
import type { CollectionWithTypes } from '@/types/collection'

interface TopbarCreateButtonProps {
  itemTypes: SidebarItemType[]
  initialCollections: CollectionWithTypes[]
}

export function TopbarCreateButton({ itemTypes, initialCollections }: TopbarCreateButtonProps) {
  const pathname = usePathname()
  const initialType = getInitialTypeFromPathname(pathname, itemTypes)
  const initialCollectionId = getCollectionIdFromPathname(pathname)

  return (
    <CreateItemDialog
      itemTypes={itemTypes}
      initialCollections={initialCollections}
      initialType={initialType}
      initialCollectionId={initialCollectionId}
    />
  )
}
