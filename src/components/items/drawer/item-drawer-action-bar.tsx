'use client'

import { useState } from 'react'
import { Star, Pin, Pencil, Trash2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { usePatchItem, useRemoveItem } from '@/hooks/use-infinite-items'
import { useRestrictedAction } from '@/hooks/use-restricted-action'
import { CopyButton } from '@/components/shared/copy-button'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DestructiveDialogFooter } from '@/components/shared/destructive-dialog-footer'
import { patch, del } from '@/lib/api/api-fetch'
import { useItemsStore } from '@/stores/items'
import { useItemDrawerStore } from '@/stores/item-drawer'
import { useAppUserFlagsStore } from '@/stores/app-user-flags'
import { usePinnedItemsStore } from '@/stores/pinned-items'
import { useOptimisticToggle } from '@/hooks/use-optimistic-toggle'
import { ITEM_TYPES_WITH_FILE, PRO_ITEM_TYPE_NAMES } from '@/lib/utils/constants'
import { getDownloadUrl } from '@/lib/utils/url'
import type { LightItem, FullItem } from '@/types/item'

interface ItemDrawerActionBarProps {
  item: LightItem | FullItem
  isLight: boolean
  fullItem: FullItem | null
  onEdit: () => void
  onDeleted: () => void
}

export function ItemDrawerActionBar({ item, isLight, fullItem, onEdit, onDeleted }: ItemDrawerActionBarProps) {
  const patchItem = usePatchItem()
  const removeItem = useRemoveItem()
  const { updateItem } = useItemsStore()
  const { setPinnedOverride } = usePinnedItemsStore()
  const { closeDrawer } = useItemDrawerStore()
  const { isPro } = useAppUserFlagsStore()
  const isRestricted = !isPro && PRO_ITEM_TYPE_NAMES.has(item.itemType.name)

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const { showError: showEditError, flash: flashEditError } = useRestrictedAction({
    title: 'Pro feature',
    description: 'Editing files and images requires a Pro plan.',
    onUpgrade: closeDrawer,
  })

  const { value: isFavorite, toggle: handleFavoriteToggle } = useOptimisticToggle(
    item.isFavorite,
    (next) => patch(`/api/items/${item.id}/favorite`, { isFavorite: next }),
    {
      onSuccess: (next) => {
        updateItem({ ...item, isFavorite: next })
        patchItem(item.id, { isFavorite: next })
      },
      errorLabel: 'Failed to toggle favorite',
    }
  )

  const { value: isPinned, toggle: handlePinToggle } = useOptimisticToggle(
    item.isPinned,
    (next) => patch(`/api/items/${item.id}/pinned`, { isPinned: next }),
    {
      onSuccess: (next) => {
        updateItem({ ...item, isPinned: next })
        patchItem(item.id, { isPinned: next })
        setPinnedOverride({ ...item, isPinned: next }, next)
      },
      errorLabel: 'Failed to toggle pin',
    }
  )

  const hasFile = ITEM_TYPES_WITH_FILE.has(item.itemType.name)
  let copyValue: string
  if (hasFile) {
    copyValue = getDownloadUrl(item.id, true)
  } else if (fullItem) {
    copyValue = fullItem.content ?? fullItem.url ?? fullItem.title
  } else {
    copyValue = item.url ?? item.title
  }

  async function handleDelete() {
    setIsDeleting(true)
    const result = await del(`/api/items/${item.id}`)
    setIsDeleting(false)

    if (result.status === 'ok') {
      toast.success('Item deleted')
      setDeleteDialogOpen(false)
      removeItem(item.id)
      onDeleted()
    } else {
      toast.error(result.message ?? 'Failed to delete item')
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        disabled={isLight}
        className={isFavorite ? 'text-yellow-500 hover:text-yellow-500' : ''}
        onClick={handleFavoriteToggle}
      >
        <Star className={`size-4 ${isFavorite ? 'fill-yellow-500' : ''}`} />
        {isFavorite ? 'Starred' : 'Favorite'}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={isLight}
        className={isPinned ? 'text-primary' : ''}
        onClick={handlePinToggle}
      >
        <Pin className={`size-4 ${isPinned ? 'fill-primary' : ''}`} />
        Pin
      </Button>
      <CopyButton value={copyValue} text="Copy" isRestricted={isRestricted} onUpgrade={closeDrawer} />
      <Button variant="ghost" size="sm" onClick={(e) => {
        if (isRestricted) {
          e.preventDefault()
          flashEditError()
          return
        }
        onEdit()
      }} disabled={isLight}>
        {showEditError ? <XCircle className="size-4 text-destructive" /> : <Pencil className="size-4" />}
        Edit
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="ml-auto text-destructive hover:text-destructive"
        onClick={() => setDeleteDialogOpen(true)}
      >
        <Trash2 className="size-4" />
      </Button>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete item?</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this {item.itemType.name}? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DestructiveDialogFooter
            onCancel={() => setDeleteDialogOpen(false)}
            onConfirm={handleDelete}
            isPending={isDeleting}
            confirmText="Delete"
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
