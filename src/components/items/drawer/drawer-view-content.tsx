'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Star, Pin, Copy, Pencil, Trash2, ExternalLink, Tag } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ItemContentView } from '@/components/shared/item-content'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ItemTags } from '@/components/shared/item-tags'
import { deleteItemAction } from '@/actions/items'
import { DrawerLayout, DrawerSection, DrawerSharedSections } from './drawer-shared'
import { ITEM_TYPES_WITH_CONTENT, ITEM_TYPES_WITH_URL } from '@/lib/utils/constants'
import type { ItemDetail } from '@/types/item'

interface DrawerViewContentProps {
  item: ItemDetail
  onClose: () => void
  onEdit: () => void
}

export function DrawerViewContent({ item, onClose, onEdit }: DrawerViewContentProps) {
  const router = useRouter()
  const { itemType } = item
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  function handleCopy() {
    const text = item.content ?? item.url ?? item.title
    navigator.clipboard.writeText(text).then(() => toast.success('Copied to clipboard'))
  }

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
    onClose()
    router.refresh()
  }

  return (
    <>
      <DrawerLayout
        itemType={itemType}
        onClose={onClose}
        titleArea={
          <>
            <h2 className="text-base font-semibold leading-snug">{item.title}</h2>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Badge variant="secondary" className="capitalize">{itemType.name}</Badge>
              {item.language && <Badge variant="outline">{item.language}</Badge>}
            </div>
          </>
        }
        actionArea={
          <>
            <Button variant="ghost" size="sm" className={item.isFavorite ? 'text-yellow-500 hover:text-yellow-500' : ''}>
              <Star className={`size-4 ${item.isFavorite ? 'fill-yellow-500' : ''}`} />
              Favorite
            </Button>
            <Button variant="ghost" size="sm" className={item.isPinned ? 'text-primary' : ''}>
              <Pin className={`size-4 ${item.isPinned ? 'fill-primary' : ''}`} />
              Pin
            </Button>
            <Button variant="ghost" size="sm" onClick={handleCopy}>
              <Copy className="size-4" />
              Copy
            </Button>
            <Button variant="ghost" size="sm" onClick={onEdit}>
              <Pencil className="size-4" />
              Edit
            </Button>
            <Button variant="ghost" size="icon-sm" className="ml-auto text-destructive hover:text-destructive" onClick={() => setDeleteDialogOpen(true)}>
              <Trash2 className="size-4" />
            </Button>
          </>
        }
      >
        {ITEM_TYPES_WITH_CONTENT.has(itemType.name) && (
          <DrawerSection label="Content" className="flex min-h-0 flex-1 flex-col">
            <ItemContentView
              itemType={itemType.name}
              content={item.content}
              language={item.language}
            />
          </DrawerSection>
        )}

        <DrawerSection label="Description">
          {item.description ? (
            <p className="text-sm leading-relaxed">{item.description}</p>
          ) : (
            <p className="text-sm text-muted-foreground">—</p>
          )}
        </DrawerSection>

        {ITEM_TYPES_WITH_URL.has(itemType.name) && (
          <DrawerSection label="URL">
            {item.url ? (
              <a href={item.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline break-all">
                {item.url}
                <ExternalLink className="size-3 shrink-0" />
              </a>
            ) : (
              <p className="text-sm text-muted-foreground">—</p>
            )}
          </DrawerSection>
        )}

        <DrawerSection label="Tags" icon={<Tag className="size-3" />}>
          {item.tags.length > 0 ? (
            <ItemTags tags={item.tags} />
          ) : (
            <p className="text-sm text-muted-foreground">—</p>
          )}
        </DrawerSection>

        <DrawerSharedSections item={item} />
      </DrawerLayout>
      
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete item?</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this {itemType.name}? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)} disabled={isDeleting}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
