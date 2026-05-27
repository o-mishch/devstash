'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import { Star, Pin, Copy, Pencil, Trash2, Calendar, FolderOpen, Tag, X, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { ItemIconWrapper } from '@/components/shared/item-icon-wrapper'
import { apiFetch } from '@/lib/api-fetch'
import { formatDate } from '@/lib/utils'
import { useResizable } from '@/hooks/use-resizable'
import type { ItemDetail } from '@/types/item'

interface ItemDetailDrawerProps {
  itemId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ItemDetailDrawer({ itemId, open, onOpenChange }: ItemDetailDrawerProps) {
  const [item, setItem] = useState<ItemDetail | null>(null)
  const { width, dragging, startResize } = useResizable({ defaultWidth: 560 })

  useEffect(() => {
    if (!open || !itemId) return

    apiFetch<ItemDetail>(`/api/items/${itemId}`)
      .then((res) => {
        if (res.status === 'ok' && res.data) setItem(res.data)
        else toast.error(res.message ?? 'Failed to load item')
      })
  }, [open, itemId])

  // Skeleton while item hasn't loaded yet or a different item was just selected
  const showSkeleton = !item || item.id !== itemId

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex flex-col gap-0 p-0"
        style={{ width, maxWidth: 'none' }}
        showCloseButton={false}
      >
        {/* Resize handle — left edge drag strip */}
        <div
          className={`absolute left-0 top-0 z-10 h-full w-1.5 cursor-ew-resize transition-colors ${dragging ? 'bg-primary/40' : 'hover:bg-primary/30'}`}
          onMouseDown={startResize}
        />

        <SheetTitle className="sr-only">{item?.title ?? 'Item details'}</SheetTitle>

        {showSkeleton ? (
          <DrawerSkeleton />
        ) : (
          <DrawerContent item={item} onClose={() => onOpenChange(false)} />
        )}
      </SheetContent>
    </Sheet>
  )
}

interface DrawerContentProps {
  item: ItemDetail
  onClose: () => void
}

function DrawerContent({ item, onClose }: DrawerContentProps) {
  const { itemType } = item

  function handleCopy() {
    const text = item.content ?? item.url ?? item.title
    navigator.clipboard.writeText(text).then(() => toast.success('Copied to clipboard'))
  }

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ '--item-color': itemType.color } as CSSProperties}>
      {/* Header */}
      <div className="flex items-start gap-3 px-5 pt-5 pb-4">
        <ItemIconWrapper itemType={itemType} wrapperClassName="mt-0.5 size-9 shrink-0" iconClassName="size-4.5" />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold leading-snug">{item.title}</h2>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Badge variant="secondary" className="capitalize">{itemType.name}</Badge>
            {item.language && <Badge variant="outline">{item.language}</Badge>}
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" className="shrink-0" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>

      <Separator />

      {/* Action bar */}
      <div className="flex items-center gap-0.5 px-2 py-1.5">
        <Button
          variant="ghost"
          size="sm"
          className={item.isFavorite ? 'text-yellow-500 hover:text-yellow-500' : ''}
        >
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
        <Button variant="ghost" size="sm">
          <Pencil className="size-4" />
          Edit
        </Button>
        <Button variant="ghost" size="icon-sm" className="ml-auto text-destructive hover:text-destructive">
          <Trash2 className="size-4" />
        </Button>
      </div>

      <Separator />

      {/* Body */}
      <div className="flex-1 min-h-0 flex flex-col gap-5 px-5 py-4 overflow-hidden">
        {item.description && (
          <section className="shrink-0">
            <SectionLabel>Description</SectionLabel>
            <p className="text-sm leading-relaxed">{item.description}</p>
          </section>
        )}

        {item.content && (
          <section className="flex min-h-0 flex-1 flex-col">
            <SectionLabel>Content</SectionLabel>
            <pre className="flex-1 min-h-0 overflow-auto rounded-md bg-muted p-3 text-xs leading-relaxed whitespace-pre">
              {item.content}
            </pre>
          </section>
        )}

        {item.url && (
          <section className="shrink-0">
            <SectionLabel>URL</SectionLabel>
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline break-all"
            >
              {item.url}
              <ExternalLink className="size-3 shrink-0" />
            </a>
          </section>
        )}

        {item.tags.length > 0 && (
          <section className="shrink-0">
            <SectionLabel icon={<Tag className="size-3" />}>Tags</SectionLabel>
            <div className="flex flex-wrap gap-1.5">
              {item.tags.map((tag) => (
                <Badge key={tag} variant="secondary">{tag}</Badge>
              ))}
            </div>
          </section>
        )}

        {item.collections.length > 0 && (
          <section className="shrink-0">
            <SectionLabel icon={<FolderOpen className="size-3" />}>Collections</SectionLabel>
            <div className="flex flex-wrap gap-1.5">
              {item.collections.map((col) => (
                <Badge key={col.id} variant="outline">{col.name}</Badge>
              ))}
            </div>
          </section>
        )}

        <section className="shrink-0">
          <SectionLabel icon={<Calendar className="size-3" />}>Details</SectionLabel>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Created</span>
              <span>{formatDate(item.createdAt)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Updated</span>
              <span>{formatDate(item.updatedAt)}</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

interface SectionLabelProps {
  children: React.ReactNode
  icon?: React.ReactNode
}

function SectionLabel({ children, icon }: SectionLabelProps) {
  return (
    <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
      {icon}
      {children}
    </p>
  )
}

function DrawerSkeleton() {
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-start gap-3 px-5 pt-5 pb-4">
        <Skeleton className="mt-0.5 size-9 shrink-0 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-1/4" />
        </div>
      </div>
      <Separator />
      {/* Action bar */}
      <div className="flex items-center gap-1 px-2 py-1.5">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-16" />
        <Skeleton className="h-8 w-16" />
        <Skeleton className="h-8 w-16" />
        <Skeleton className="ml-auto h-8 w-8" />
      </div>
      <Separator />
      {/* Body */}
      <div className="flex-1 min-h-0 flex flex-col gap-5 px-5 py-4 overflow-hidden">
        {/* Description */}
        <div className="shrink-0 space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
        {/* Content block — fills remaining space */}
        <div className="flex flex-1 min-h-0 flex-col space-y-2">
          <Skeleton className="h-3 w-16 shrink-0" />
          <Skeleton className="flex-1 min-h-0 w-full rounded-md" />
        </div>
        {/* Tags */}
        <div className="shrink-0 space-y-2">
          <Skeleton className="h-3 w-12" />
          <div className="flex gap-1.5">
            <Skeleton className="h-6 w-14" />
            <Skeleton className="h-6 w-14" />
          </div>
        </div>
      </div>
    </div>
  )
}
