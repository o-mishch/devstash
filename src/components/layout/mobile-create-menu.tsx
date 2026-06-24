'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CreateItemDialog } from '@/components/items/item-create-dialog'

import { getInitialTypeFromPathname, getCollectionIdFromPathname } from '@/lib/utils/url'
import { useUserProfile } from '@/hooks/profile/use-user-profile'
import { useUpgradePromptStore } from '@/stores/upgrade-prompt'
import type { SidebarItemType } from '@/types/item'
import type { CollectionWithTypes } from '@/types/collection'

interface MobileCreateMenuProps {
  itemTypes: SidebarItemType[]
  initialCollections: CollectionWithTypes[]
}

export function MobileCreateMenu({ itemTypes, initialCollections }: MobileCreateMenuProps) {
  const { data: profile } = useUserProfile()
  const canCreateItem = profile?.canCreateItem ?? true
  const canCreateCollection = profile?.canCreateCollection ?? true
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
        initialCollections={initialCollections}
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
