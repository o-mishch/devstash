'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Star, Pin, Copy, Check, Pencil, Trash2, ExternalLink, Tag, Download, FileIcon } from 'lucide-react'
import { toast } from 'sonner'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ItemContentView } from '@/components/shared/item-content-view'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DestructiveDialogFooter } from '@/components/shared/destructive-dialog-footer'
import { ItemTags } from '@/components/shared/item-tags'
import { deleteItemAction } from '@/actions/items'
import { DrawerLayout, DrawerSection, DrawerSharedSections } from './drawer-shared'
import { ITEM_TYPES_WITH_CONTENT, ITEM_TYPES_WITH_URL, ITEM_TYPES_WITH_FILE } from '@/lib/utils/constants'
import { formatBytes } from '@/lib/utils/format'
import type { Item, LightItem } from '@/types/item'

interface FileSectionProps {
  item: LightItem | Item
}

function FileSectionContent({ item }: FileSectionProps) {
  if (!item.fileUrl) return <p className="text-sm text-muted-foreground">—</p>

  if (item.itemType.name === 'image') {
    return (
      <div className="flex justify-center">
        <div className="group relative flex max-w-full items-center justify-center overflow-hidden rounded-md border border-border bg-muted/30">
          <Image
            src={`/api/download/${item.id}`}
            alt={item.fileName ?? item.title}
            width={0}
            height={0}
            unoptimized
            priority
            className="h-auto w-auto max-h-[50vh] max-w-full object-contain"
          />
          <a
            href={`/api/download/${item.id}`}
            download={item.fileName ?? item.title}
            className="absolute right-2 top-2 rounded-md bg-background/50 p-1.5 backdrop-blur-sm transition-colors hover:bg-background/80 opacity-0 group-hover:opacity-100 focus:opacity-100"
            title="Download image"
          >
            <Download className="size-4 text-foreground" />
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 px-3 py-2.5">
      <FileIcon className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.fileName ?? '—'}</p>
        {item.fileSize != null && (
          <p className="text-xs text-muted-foreground">{formatBytes(item.fileSize)}</p>
        )}
      </div>
      <a href={`/api/download/${item.id}`} download={item.fileName ?? item.title}>
        <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0">
          <Download className="size-3.5" />
        </Button>
      </a>
    </div>
  )
}

interface ItemDrawerViewContentProps {
  item: LightItem | Item
  isLight: boolean
  onClose: () => void
  onEdit: () => void
  onDeleted: () => void
}

export function ItemDrawerViewContent({ item, isLight, onClose, onEdit, onDeleted }: ItemDrawerViewContentProps) {
  const { itemType } = item
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const fullItem = isLight ? null : (item as Item)
  const description = isLight ? (item as LightItem).descriptionPreview : (item as Item).description
  const copyValue = fullItem ? (fullItem.content ?? fullItem.url ?? fullItem.title) : (item.url ?? item.title)

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
      <DrawerLayout
        itemType={itemType}
        onClose={onClose}
        titleArea={
          <>
            <h2 className="text-base font-semibold leading-snug">{item.title}</h2>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Badge variant="secondary" className="capitalize">{itemType.name}</Badge>
              {fullItem?.language && <Badge variant="outline">{fullItem.language}</Badge>}
            </div>
          </>
        }
        actionArea={
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
            <Button variant="ghost" size="icon-sm" className="ml-auto text-destructive hover:text-destructive" onClick={() => setDeleteDialogOpen(true)}>
              <Trash2 className="size-4" />
            </Button>
          </>
        }
      >
        {ITEM_TYPES_WITH_CONTENT.has(itemType.name) && (
          <DrawerSection label="Content" className="flex min-h-0 flex-1 flex-col">
            {isLight ? (
              <Skeleton className="flex-1 min-h-[120px] w-full rounded-md" />
            ) : (
              <ItemContentView
                itemType={itemType.name}
                content={fullItem!.content}
                language={fullItem!.language}
              />
            )}
          </DrawerSection>
        )}

        {ITEM_TYPES_WITH_FILE.has(itemType.name) && (
          <DrawerSection label={itemType.name === 'image' ? 'Image' : 'File'}>
            <FileSectionContent item={item} />
          </DrawerSection>
        )}

        <DrawerSection label="Description">
          {description ? (
            <p className="text-sm leading-relaxed">{description}</p>
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

        {fullItem && <DrawerSharedSections item={fullItem} />}
      </DrawerLayout>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete item?</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this {itemType.name}? This action cannot be undone.
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
