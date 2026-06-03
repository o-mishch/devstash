'use client'

import { usePathname } from 'next/navigation'
import { CreateItemDialog } from '@/components/items/item-create-dialog'
import type { SidebarItemType } from '@/types/item'
import type { CollectionWithTypes } from '@/types/collection'

interface TopbarCreateButtonProps {
  itemTypes: SidebarItemType[]
  collections: CollectionWithTypes[]
}

export function TopbarCreateButton({ itemTypes, collections }: TopbarCreateButtonProps) {
  const pathname = usePathname()
  const match = pathname.match(/^\/items\/(\w+)$/)
  const slug = match?.[1]
  const initialType = itemTypes.find(t => `${t.name}s` === slug)?.name

  return (
    <CreateItemDialog
      itemTypes={itemTypes}
      collections={collections}
      initialType={initialType}
    />
  )
}
