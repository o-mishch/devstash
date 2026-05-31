'use client'

import { useState } from 'react'
import { Star, Pin, Copy, Check, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DestructiveDialogFooter } from '@/components/shared/destructive-dialog-footer'
import { deleteItemAction } from '@/actions/items'
import type { Item, LightItem } from '@/types/item'

interface ItemDrawerActionBarProps {
  item: LightItem | Item
  isLight: boolean
  fullItem: Item | null
  onEdit: () => void
  onDeleted: () => void
}

export function ItemDrawerActionBar({ item, isLight, fullItem, onEdit, onDeleted }: ItemDrawerActionBarProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const copyValue = fullItem
    ? (fullItem.content ?? fullItem.url ?? fullItem.title)
    : (item.url ?? item.title)
  const { isCopied, copy } = useCopyToClipboard()

  async function handleDelete() {
    setIsDeleting(true)
    const result = await deleteItemAction(item.id)
    setIsDeleting(false)

    if (result.status !== 'ok') {
      toast.error(result.message ?? 'Failed to delete item')
      return
    }

    toast.success('Item deleted')
    setDeleteDialogOpen(false)
    onDeleted()
  }

  return (
    <>
      <Button variant="ghost" size="sm" disabled={isLight} className={fullItem?.isFavorite ? 'text-yellow-500 hover:text-yellow-500' : ''}>
        <Star className={`size-4 ${fullItem?.isFavorite ? 'fill-yellow-500' : ''}`} />
        Favorite
      </Button>
      <Button variant="ghost" size="sm" disabled={isLight} className={fullItem?.isPinned ? 'text-primary' : ''}>
        <Pin className={`size-4 ${fullItem?.isPinned ? 'fill-primary' : ''}`} />
        Pin
      </Button>
      <Button variant="ghost" size="sm" onClick={() => copy(copyValue)}>
        {isCopied ? <Check className="size-4 text-green-400" /> : <Copy className="size-4" />}
        Copy
      </Button>
      <Button variant="ghost" size="sm" onClick={onEdit} disabled={isLight}>
        <Pencil className="size-4" />
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
