'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { Plus, FolderPlus, Package } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { CreateItemDialog } from '@/components/items/item-create-dialog'
import { CollectionCreateDialog } from '@/components/dashboard/collection-create-dialog'
import { FREE_TIER_ITEM_LIMIT, FREE_TIER_COLLECTION_LIMIT } from '@/lib/usage'
import { getInitialTypeFromPathname } from '@/lib/utils/url'
import { useUpgradePrompt } from '@/context/upgrade-prompt-context'
import type { SidebarItemType } from '@/types/item'
import type { CollectionWithTypes } from '@/types/collection'

interface MobileCreateMenuProps {
  itemTypes: SidebarItemType[]
  collections: CollectionWithTypes[]
  canCreateItem?: boolean
  canCreateCollection?: boolean
  isPro?: boolean
}

export function MobileCreateMenu({ itemTypes, collections, canCreateItem = true, canCreateCollection = true, isPro = false }: MobileCreateMenuProps) {
  const { showUpgradePrompt } = useUpgradePrompt()
  const [itemOpen, setItemOpen] = useState(false)
  const [collectionOpen, setCollectionOpen] = useState(false)
  const pathname = usePathname()
  const initialType = getInitialTypeFromPathname(pathname, itemTypes)

  return (
    <>
      {itemOpen && (
        <CreateItemDialog
          itemTypes={itemTypes}
          collections={collections}
          open={itemOpen}
          onOpenChange={setItemOpen}
          initialType={initialType}
          trigger={<></>}
          isPro={isPro}
        />
      )}
      {collectionOpen && (
        <CollectionCreateDialog
          open={collectionOpen}
          onOpenChange={setCollectionOpen}
          trigger={<></>}
        />
      )}

      <DropdownMenu>
        <DropdownMenuTrigger render={
          <Button size="icon" className="size-9 lg:hidden" aria-label="Create new">
            <Plus className="size-4" />
          </Button>
        } />
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={(e) => {
            if (!canCreateItem) {
              e.preventDefault()
              showUpgradePrompt({ title: 'Item limit reached', description: `You've used all ${FREE_TIER_ITEM_LIMIT} free items.` })
              return
            }
            setItemOpen(true)
          }}>
            <Package className="size-4" />
            New Item
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={(e) => {
            if (!canCreateCollection) {
              e.preventDefault()
              showUpgradePrompt({ title: 'Collection limit reached', description: `You've used all ${FREE_TIER_COLLECTION_LIMIT} free collections.` })
              return
            }
            setCollectionOpen(true)
          }}>
            <FolderPlus className="size-4" />
            New Collection
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
