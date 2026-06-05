'use client'

import { usePathname } from 'next/navigation'
import { CreateItemDialog } from '@/components/items/item-create-dialog'
import { getInitialTypeFromPathname } from '@/lib/utils/format'
import type { SidebarItemType } from '@/types/item'
import type { CollectionWithTypes } from '@/types/collection'

interface TopbarCreateButtonProps {
  itemTypes: SidebarItemType[]
  collections: CollectionWithTypes[]
  canCreateItem?: boolean
  isPro?: boolean
}

export function TopbarCreateButton({ itemTypes, collections, canCreateItem = true, isPro = false }: TopbarCreateButtonProps) {
  const pathname = usePathname()
  const initialType = getInitialTypeFromPathname(pathname, itemTypes)

  return (
    <CreateItemDialog
      itemTypes={itemTypes}
      collections={collections}
      initialType={initialType}
      canCreate={canCreateItem}
      isPro={isPro}
    />
  )
}
