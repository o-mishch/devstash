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
import type { SidebarItemType } from '@/types/item'
import type { CollectionWithTypes } from '@/types/collection'

interface MobileCreateMenuProps {
  itemTypes: SidebarItemType[]
  collections: CollectionWithTypes[]
}

export function MobileCreateMenu({ itemTypes, collections }: MobileCreateMenuProps) {
  const [itemOpen, setItemOpen] = useState(false)
  const [collectionOpen, setCollectionOpen] = useState(false)
  const pathname = usePathname()
  const match = pathname.match(/^\/items\/(\w+)$/)
  const initialType = itemTypes.find(t => `${t.name}s` === match?.[1])?.name

  return (
    <>
      {/* Dialogs are always mounted; controlled externally by dropdown selection */}
      <CreateItemDialog
        itemTypes={itemTypes}
        collections={collections}
        open={itemOpen}
        onOpenChange={setItemOpen}
        initialType={initialType}
        trigger={<span className="hidden" />}
      />
      <CollectionCreateDialog
        open={collectionOpen}
        onOpenChange={setCollectionOpen}
        trigger={<span className="hidden" />}
      />

      <DropdownMenu>
        <DropdownMenuTrigger render={
          <Button size="icon" className="size-9 lg:hidden" aria-label="Create new">
            <Plus className="size-4" />
          </Button>
        } />
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={() => setItemOpen(true)}>
            <Package className="size-4" />
            New Item
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setCollectionOpen(true)}>
            <FolderPlus className="size-4" />
            New Collection
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
