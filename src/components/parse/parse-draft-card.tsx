'use client'

import { useState, type FormEvent } from 'react'
import { GripVertical, Pencil, Trash2, Check, Loader2, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  usePatchBrainDumpDraftItem,
  useDeleteBrainDumpDraftItem,
  useCommitBrainDumpDraftItem,
  type BrainDumpDraftItem,
} from '@/hooks/use-brain-dump'
import {
  ITEM_TYPES_WITH_CONTENT,
  ITEM_TYPES_WITH_LANGUAGE,
  ITEM_TYPES_WITH_URL,
} from '@/lib/utils/constants'
import { cn, getTypeLabel } from '@/lib/utils'
import { ItemTypeIcon } from '@/components/shared/item-type-icon'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'

interface ParseDraftCardProps {
  jobId: string
  item: BrainDumpDraftItem
  inTrash: boolean
  rootRef: (element: Element | null) => void
  handleRef: (element: Element | null) => void
  isDragging: boolean
  // Bumped (+1/-1) around trash-membership mutations so the board can block Empty Trash while one is
  // in flight (a restore the server hasn't committed must not be deleted by an empty-trash).
  onPatchPending: (delta: number) => void
  onEdited: (patch: Partial<BrainDumpDraftItem>) => void
  onRemoved: () => void
}

export function ParseDraftCard({
  jobId,
  item,
  inTrash,
  rootRef,
  handleRef,
  isDragging,
  onPatchPending,
  onEdited,
  onRemoved,
}: ParseDraftCardProps) {
  const patchDraft = usePatchBrainDumpDraftItem()
  const deleteDraft = useDeleteBrainDumpDraftItem()
  const commitDraft = useCommitBrainDumpDraftItem()
  const [editOpen, setEditOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  // Soft delete: move the draft to the Trash bucket (recoverable) rather than removing it.
  const trash = async () => {
    setBusy(true)
    onPatchPending(1)
    const result = await patchDraft(jobId, item.id, { trashed: true })
    onPatchPending(-1)
    setBusy(false)
    if (!result.ok) {
      toast.error('Could not move to trash')
      return
    }
    onEdited({ trashed: true })
  }

  // Restore from the Trash bucket back to its type bucket.
  const restore = async () => {
    setBusy(true)
    onPatchPending(1)
    const result = await patchDraft(jobId, item.id, { trashed: false })
    onPatchPending(-1)
    setBusy(false)
    if (!result.ok) {
      toast.error('Could not restore draft')
      return
    }
    onEdited({ trashed: false })
  }

  // Permanent delete (from the Trash bucket only) — removes the row for good.
  const deleteForever = async () => {
    setBusy(true)
    onPatchPending(1)
    const ok = await deleteDraft(jobId, item.id)
    onPatchPending(-1)
    setBusy(false)
    if (!ok) {
      toast.error('Could not delete draft')
      return
    }
    onRemoved()
  }

  // Per-item "Save now": commit this draft into a real item, attached to the job's collection target
  // (same as the batch "Save all"), then drop the draft. Spends no AI budget (just createItem).
  const saveNow = async () => {
    setBusy(true)
    const result = await commitDraft(jobId, item.id)
    setBusy(false)
    if (!result.ok) {
      toast.error(result.message ?? 'Could not save item')
      return
    }
    toast.success(`Saved “${item.title}”`)
    onRemoved()
  }

  const preview = item.itemTypeName === 'link' ? item.url : item.content

  return (
    <div
      ref={rootRef}
      className={cn(
        'group rounded-lg border border-border bg-card p-3 shadow-sm transition-shadow hover:shadow-md',
        isDragging && 'opacity-50',
      )}
    >
      <div className="flex items-start gap-2">
        <button
          ref={handleRef}
          type="button"
          aria-label="Drag to another bucket"
          className="mt-0.5 cursor-grab text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="size-4" />
        </button>
        <ItemTypeIcon typeName={item.itemTypeName} className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{item.title}</p>
          {item.description && (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.description}</p>
          )}
          {preview && (
            <pre className="mt-1.5 max-h-20 overflow-hidden rounded bg-muted/60 p-2 text-[11px] leading-snug whitespace-pre-wrap break-words text-muted-foreground">
              {preview.slice(0, 240)}
            </pre>
          )}
          {item.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {item.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="px-1.5 py-0 text-[10px]">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        {inTrash ? (
          <>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={restore} disabled={busy}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Undo2 className="size-3.5" />} Restore
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-destructive hover:text-destructive"
              onClick={deleteForever}
              disabled={busy}
            >
              <Trash2 className="size-3.5" /> Delete forever
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setEditOpen(true)} disabled={busy}>
              <Pencil className="size-3.5" /> Edit
            </Button>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={trash} disabled={busy}>
              <Trash2 className="size-3.5" /> Delete
            </Button>
            <Button size="sm" className="h-7 px-2 text-xs" onClick={saveNow} disabled={busy}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Save now
            </Button>
          </>
        )}
      </div>

      <EditDraftDrawer
        key={editOpen ? `${item.id}:${item.title}:${item.content?.length ?? 0}` : 'closed'}
        open={editOpen}
        onOpenChange={setEditOpen}
        jobId={jobId}
        item={item}
        patchDraft={patchDraft}
        onEdited={onEdited}
      />
    </div>
  )
}

interface EditDraftDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  jobId: string
  item: BrainDumpDraftItem
  patchDraft: ReturnType<typeof usePatchBrainDumpDraftItem>
  onEdited: (patch: Partial<BrainDumpDraftItem>) => void
}

function EditDraftDrawer({ open, onOpenChange, jobId, item, patchDraft, onEdited }: EditDraftDrawerProps) {
  const [title, setTitle] = useState(item.title)
  const [description, setDescription] = useState(item.description ?? '')
  const [content, setContent] = useState(item.content ?? '')
  const [url, setUrl] = useState(item.url ?? '')
  const [language, setLanguage] = useState(item.language ?? '')
  const [tags, setTags] = useState(item.tags.join(', '))
  const [saving, setSaving] = useState(false)

  const hasContent = ITEM_TYPES_WITH_CONTENT.has(item.itemTypeName)
  const hasUrl = ITEM_TYPES_WITH_URL.has(item.itemTypeName)
  const hasLanguage = ITEM_TYPES_WITH_LANGUAGE.has(item.itemTypeName)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const patch: Partial<BrainDumpDraftItem> = {
      title: title.trim(),
      description: description.trim() || null,
      content: hasContent ? content : null,
      url: hasUrl ? url.trim() || null : null,
      language: hasLanguage ? language.trim() || null : null,
      tags: tags
        .split(',')
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 5),
    }
    setSaving(true)
    const result = await patchDraft(jobId, item.id, patch)
    setSaving(false)
    if (!result.ok) {
      toast.error('Could not save changes')
      return
    }
    onEdited(result.item ?? patch)
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-5 sm:max-w-md">
        <div className="mb-4">
          <SheetTitle className="flex items-center gap-2">
            <ItemTypeIcon typeName={item.itemTypeName} className="size-4" />
            Edit {getTypeLabel(item.itemTypeName)} draft
          </SheetTitle>
          <p className="mt-1 text-xs text-muted-foreground">Changes are saved to the draft and persist on refresh.</p>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="draft-title">Title</Label>
            <Input id="draft-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          {hasUrl && (
            <div className="space-y-1">
              <Label htmlFor="draft-url">URL</Label>
              <Input id="draft-url" value={url} onChange={(e) => setUrl(e.target.value)} type="url" />
            </div>
          )}
          {hasContent && (
            <div className="space-y-1">
              <Label htmlFor="draft-content">Content</Label>
              <Textarea
                id="draft-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={6}
                className="font-mono text-xs"
              />
            </div>
          )}
          {hasLanguage && (
            <div className="space-y-1">
              <Label htmlFor="draft-language">Language</Label>
              <Input id="draft-language" value={language} onChange={(e) => setLanguage(e.target.value)} />
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="draft-description">Description</Label>
            <Input id="draft-description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="draft-tags">Tags (comma-separated, max 5)</Label>
            <Input id="draft-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !title.trim()}>
              {saving && <Loader2 className="size-4 animate-spin" />} Save
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}
