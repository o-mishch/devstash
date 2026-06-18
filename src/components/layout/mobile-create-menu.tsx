'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CreateItemDialog } from '@/components/items/item-create-dialog'

import { getInitialTypeFromPathname, getCollectionIdFromPathname } from '@/lib/utils/url'
import { useAppUserFlagsStore } from '@/stores/app-user-flags'
import { useUpgradePromptStore } from '@/stores/upgrade-prompt'
import type { SidebarItemType } from '@/types/item'
import type { CollectionPickerItem } from '@/types/collection'

interface MobileCreateMenuProps {
  itemTypes: SidebarItemType[]
  collections: CollectionPickerItem[]
}

export function MobileCreateMenu({ itemTypes, collections }: MobileCreateMenuProps) {
  const { canCreateItem, canCreateCollection } = useAppUserFlagsStore()
  const { openPrompt } = useUpgradePromptStore()
  const [itemOpen, setItemOpen] = useState(false)
  const pathname = usePathname()
  const initialType = getInitialTypeFromPathname(pathname, itemTypes)
  const initialCollectionId = getCollectionIdFromPathname(pathname)

  return (
    <>
      {/* Kept always mounted (not `{itemOpen && …}`) so the sheet exists in the closed state
          first and `open` flips false→true on tap — that closed→open transition is what lets
          Base UI play the slide-up enter animation. Mounting already-open skips it (pops in). */}
      <CreateItemDialog
        itemTypes={itemTypes}
        collections={collections}
        open={itemOpen}
        onOpenChange={setItemOpen}
        initialType={initialType}
        initialCollectionId={initialCollectionId}
        trigger={<></>}
      />

      <Button
        size="icon"
        className="size-9 touch:size-11 lg:hidden"
        aria-label="Create new"
        onClick={() => {
          if (!canCreateItem && !canCreateCollection) {
            openPrompt({ title: 'Limits reached', description: `You've used all free items and collections. Please upgrade to Pro.` })
            return
          }
          setItemOpen(true)
        }}
      >
        <Plus className="size-4" />
      </Button>
    </>
  )
}
