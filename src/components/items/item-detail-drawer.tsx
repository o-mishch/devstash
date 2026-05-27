'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { Star, Pin, Copy, Pencil, Trash2, Calendar, FolderOpen, Tag, X, ExternalLink, Check } from 'lucide-react'
import { toast } from 'sonner'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { ItemIconWrapper } from '@/components/shared/item-icon-wrapper'
import { apiFetch } from '@/lib/api-fetch'
import { formatDate } from '@/lib/utils'
import { useResizable } from '@/hooks/use-resizable'
import { updateItemAction, deleteItemAction } from '@/actions/items'
import type { ItemDetail } from '@/types/item'

const CONTENT_TYPES = new Set(['snippet', 'prompt', 'command', 'note'])
const LANGUAGE_TYPES = new Set(['snippet', 'command'])

interface ItemDetailDrawerProps {
  itemId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ItemDetailDrawer({ itemId, open, onOpenChange }: ItemDetailDrawerProps) {
  const [item, setItem] = useState<ItemDetail | null>(null)
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const { width, dragging, startResize } = useResizable({ defaultWidth: 560 })
  
  const editing = editingItemId === itemId

  useEffect(() => {
    if (!open || !itemId) return
    apiFetch<ItemDetail>(`/api/items/${itemId}`)
      .then((res) => {
        if (res.status === 'ok' && res.data) setItem(res.data)
        else toast.error(res.message ?? 'Failed to load item')
      })
  }, [open, itemId])

  const showSkeleton = !item || item.id !== itemId

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex flex-col gap-0 p-0"
        style={{ width, maxWidth: 'none' }}
        showCloseButton={false}
      >
        <div
          className={`absolute left-0 top-0 z-10 h-full w-1.5 cursor-ew-resize transition-colors ${dragging ? 'bg-primary/40' : 'hover:bg-primary/30'}`}
          onMouseDown={startResize}
        />

        <SheetTitle className="sr-only">{item?.title ?? 'Item details'}</SheetTitle>

        {showSkeleton ? (
          <DrawerSkeleton />
        ) : editing ? (
          <DrawerEditContent
            item={item}
            onClose={() => onOpenChange(false)}
            onSave={(updated) => { setItem(updated); setEditingItemId(null) }}
            onCancel={() => setEditingItemId(null)}
          />
        ) : (
          <DrawerViewContent
            item={item}
            onClose={() => onOpenChange(false)}
            onEdit={() => setEditingItemId(itemId)}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

// ── View mode ────────────────────────────────────────────────────────────────

interface DrawerViewContentProps {
  item: ItemDetail
  onClose: () => void
  onEdit: () => void
}

function DrawerViewContent({ item, onClose, onEdit }: DrawerViewContentProps) {
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
      {CONTENT_TYPES.has(itemType.name) && (
        <section className="flex min-h-0 flex-1 flex-col">
          <SectionLabel>Content</SectionLabel>
          {item.content
            ? <pre className="flex-1 min-h-0 overflow-auto rounded-md bg-muted p-3 text-xs leading-relaxed whitespace-pre">{item.content}</pre>
            : <p className="text-sm text-muted-foreground">—</p>}
        </section>
      )}

      <section className="shrink-0">
        <SectionLabel>Description</SectionLabel>
        {item.description
          ? <p className="text-sm leading-relaxed">{item.description}</p>
          : <p className="text-sm text-muted-foreground">—</p>}
      </section>

      {itemType.name === 'link' && (
        <section className="shrink-0">
          <SectionLabel>URL</SectionLabel>
          {item.url
            ? <a href={item.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline break-all">
                {item.url}
                <ExternalLink className="size-3 shrink-0" />
              </a>
            : <p className="text-sm text-muted-foreground">—</p>}
        </section>
      )}

      <section className="shrink-0">
        <SectionLabel icon={<Tag className="size-3" />}>Tags</SectionLabel>
        {item.tags.length > 0
          ? <div className="flex flex-wrap gap-1.5">{item.tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}</div>
          : <p className="text-sm text-muted-foreground">—</p>}
      </section>

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

// ── Edit mode ────────────────────────────────────────────────────────────────

interface DrawerEditContentProps {
  item: ItemDetail
  onClose: () => void
  onSave: (updated: ItemDetail) => void
  onCancel: () => void
}

function DrawerEditContent({ item, onClose, onSave, onCancel }: DrawerEditContentProps) {
  const router = useRouter()
  const { itemType } = item
  const typeName = itemType.name

  const [title, setTitle] = useState(item.title)
  const [description, setDescription] = useState(item.description ?? '')
  const [content, setContent] = useState(item.content ?? '')
  const [url, setUrl] = useState(item.url ?? '')
  const [language, setLanguage] = useState(item.language ?? '')
  const [tags, setTags] = useState(item.tags.join(', '))
  const [saving, setSaving] = useState(false)

  const showContent = CONTENT_TYPES.has(typeName)
  const showLanguage = LANGUAGE_TYPES.has(typeName)
  const showUrl = typeName === 'link'

  async function handleSave() {
    if (!title.trim()) return
    setSaving(true)

    const tagArray = tags.split(',').map((t) => t.trim()).filter(Boolean)

    const result = await updateItemAction(item.id, {
      title: title.trim(),
      description: description.trim() || null,
      content: content || null,
      url: url.trim() || null,
      language: language.trim() || null,
      tags: tagArray,
    })

    setSaving(false)

    if (result.status !== 'ok' || !result.data) {
      toast.error(result.message ?? 'Failed to save item')
      return
    }

    toast.success('Item saved')
    router.refresh()
    onSave(result.data)
  }

  return (
    <DrawerLayout
      itemType={itemType}
      onClose={onClose}
      titleArea={
        <>
          <Textarea
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Item title"
            rows={1}
            className="-my-1 min-h-0 resize-none border-transparent bg-transparent px-2 py-1 -ml-2 text-base font-semibold leading-snug shadow-none transition-colors hover:bg-accent/50 focus-visible:border-ring focus-visible:bg-transparent focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="capitalize">{typeName}</Badge>
            {showLanguage && (
              <Input
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                placeholder="Language"
                className="h-5 w-24 rounded-md border-border/60 px-1.5 py-0 text-xs shadow-none transition-colors hover:bg-accent/50 focus-visible:bg-transparent focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            )}
          </div>
        </>
      }
      actionArea={
        <>
          <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
            <X className="size-4" />
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !title.trim()}>
            <Check className="size-4" />
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      {showContent && (
        <section className="flex min-h-0 flex-1 flex-col space-y-1.5">
          <SectionLabel>Content</SectionLabel>
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Content"
            className="flex-1 min-h-0 resize-none font-mono text-xs"
          />
        </section>
      )}

      <section className="shrink-0 space-y-1.5">
        <SectionLabel>Description</SectionLabel>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description"
          className="min-h-[3rem] resize-none"
        />
      </section>

      {showUrl && (
        <section className="shrink-0 space-y-1.5">
          <SectionLabel>URL</SectionLabel>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://..."
            type="url"
          />
        </section>
      )}

      <section className="shrink-0 space-y-1.5">
        <SectionLabel icon={<Tag className="size-3" />}>Tags</SectionLabel>
        <Input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="react, hooks, typescript"
        />
        <p className="text-xs text-muted-foreground">Comma-separated</p>
      </section>

      <DrawerSharedSections item={item} />
    </DrawerLayout>
  )
}

// ── Shared ───────────────────────────────────────────────────────────────────

interface DrawerLayoutProps {
  itemType: ItemDetail['itemType']
  onClose: () => void
  titleArea: React.ReactNode
  actionArea: React.ReactNode
  children: React.ReactNode
}

function DrawerLayout({ itemType, onClose, titleArea, actionArea, children }: DrawerLayoutProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ '--item-color': itemType.color } as CSSProperties}>
      <div className="flex items-start gap-3 px-5 pt-5 pb-4">
        <ItemIconWrapper itemType={itemType} wrapperClassName="mt-0.5 size-9 shrink-0" iconClassName="size-4.5" />
        <div className="min-w-0 flex-1">{titleArea}</div>
        <Button variant="ghost" size="icon-sm" className="shrink-0" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>
      <Separator />
      <div className="flex items-center gap-0.5 px-2 py-1.5">{actionArea}</div>
      <Separator />
      <div className="flex-1 min-h-0 flex flex-col gap-5 px-5 py-4 overflow-hidden">
        {children}
      </div>
    </div>
  )
}

function DrawerSharedSections({ item }: { item: ItemDetail }) {
  return (
    <>
      <section className="shrink-0">
        <SectionLabel icon={<FolderOpen className="size-3" />}>Collections</SectionLabel>
        {item.collections.length > 0
          ? <div className="flex flex-wrap gap-1.5">{item.collections.map((col) => <Badge key={col.id} variant="outline">{col.name}</Badge>)}</div>
          : <p className="text-sm text-muted-foreground">—</p>}
      </section>

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
    </>
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
      <div className="flex items-start gap-3 px-5 pt-5 pb-4">
        <Skeleton className="mt-0.5 size-9 shrink-0 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-1/4" />
        </div>
      </div>
      <Separator />
      <div className="flex items-center gap-1 px-2 py-1.5">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-16" />
        <Skeleton className="h-8 w-16" />
        <Skeleton className="h-8 w-16" />
        <Skeleton className="ml-auto h-8 w-8" />
      </div>
      <Separator />
      <div className="flex-1 min-h-0 flex flex-col gap-5 px-5 py-4 overflow-hidden">
        {/* Content block — fills remaining space */}
        <div className="flex flex-1 min-h-0 flex-col space-y-2">
          <Skeleton className="h-3 w-16 shrink-0" />
          <Skeleton className="flex-1 min-h-0 w-full rounded-md" />
        </div>
        {/* Description */}
        <div className="shrink-0 space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
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
