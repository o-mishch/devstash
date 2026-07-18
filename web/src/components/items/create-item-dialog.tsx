import type { MouseEvent, ReactNode, SyntheticEvent } from 'react'
import { useState } from 'react'
import { Plus } from 'lucide-react'
import { ITEM_TYPES, itemTypeMeta } from '@/lib/item-types'
import type { ItemTypeName } from '@/lib/item-types'
import { useCreateItem } from '@/hooks/use-items'
import { useCreateCollection } from '@/hooks/use-collections'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ResponsiveFormDialog, morphOriginFromClick } from '@/components/ui/responsive-form-dialog'
import type { MorphOrigin } from '@/components/ui/responsive-form-dialog'

// Creatable types = everything except the Pro file/image types, which need the upload flow
// (Backend Phase 3, not yet migrated). They still render in lists, just can't be created here.
const CREATABLE_TYPES = ITEM_TYPES.filter((t) => !('pro' in t))

// The Type select doubles as the item-vs-collection switch, mirroring the legacy unified dialog:
// picking "Collection" swaps the body to the collection form rather than opening a second dialog.
const COLLECTION_OPTION = '__collection__'
type CreateMode = ItemTypeName | typeof COLLECTION_OPTION

interface CreateItemDialogProps {
  /** Preselected type (e.g. opened from an `/items/[type]` page). */
  initialType?: ItemTypeName
}

/**
 * The unified create dialog: one wide, morph-opening dialog that creates an item OR a collection,
 * chosen from the Type select. Desktop renders a centered dialog that grows out of the clicked
 * button; mobile renders a near-full-height bottom sheet with swipe-to-dismiss.
 */
export function CreateItemDialog({ initialType }: CreateItemDialogProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [morphOrigin, setMorphOrigin] = useState<MorphOrigin | null>(null)
  const [mode, setMode] = useState<CreateMode>(initialType ?? 'snippet')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [url, setUrl] = useState('')
  const [tags, setTags] = useState('')
  const [description, setDescription] = useState('')
  const createItem = useCreateItem()
  const createCollection = useCreateCollection()

  const isCollection = mode === COLLECTION_OPTION
  const pending = isCollection ? createCollection.isPending : createItem.isPending
  const trimmedTitle = title.trim()
  const canSubmit = trimmedTitle.length > 0 && !pending

  const reset = (): void => {
    setTitle('')
    setContent('')
    setUrl('')
    setTags('')
    setDescription('')
    setMode(initialType ?? 'snippet')
  }

  const openDialog = (e: MouseEvent): void => {
    setMorphOrigin(morphOriginFromClick(e))
    setOpen(true)
  }

  const onModeChange = (value: unknown): void => {
    const next = String(value)
    if (next === COLLECTION_OPTION) {
      setMode(COLLECTION_OPTION)
      return
    }
    // Narrow through the registry rather than casting: an unknown name simply doesn't match.
    const meta = itemTypeMeta(next)
    if (meta) setMode(meta.name)
  }

  const onSubmit = (e: SyntheticEvent<HTMLFormElement>): void => {
    e.preventDefault()
    if (trimmedTitle.length === 0) return
    const done = {
      onSuccess: (): void => {
        reset()
        setOpen(false)
      },
    }

    if (isCollection) {
      createCollection.mutate(
        { body: { name: trimmedTitle, description: description.trim() || undefined } },
        done,
      )
      return
    }

    const tagList = tags
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
    createItem.mutate(
      {
        body: {
          title: trimmedTitle,
          itemTypeName: mode,
          content: content.trim() || undefined,
          url: mode === 'link' ? url.trim() || undefined : undefined,
          tags: tagList.length > 0 ? tagList : undefined,
        },
      },
      done,
    )
  }

  return (
    <>
      <Button size="sm" onClick={openDialog}>
        <Plus className="size-4" />
        New Item
      </Button>

      <ResponsiveFormDialog
        open={open}
        onOpenChange={setOpen}
        title={isCollection ? 'New Collection' : 'New Item'}
        description={
          isCollection
            ? 'Group related items together.'
            : 'Stash a snippet, prompt, command, note or link.'
        }
        morphOrigin={morphOrigin}
        desktopClassName="flex max-h-[90dvh] flex-col gap-2 sm:max-w-[860px]"
        // Near-full-height on mobile so the content field has room and the sheet doesn't jump as
        // the body changes height between types.
        mobileClassName="data-[side=bottom]:h-[calc(100dvh-3.5rem)]"
      >
        {(isDesktop) => (
          <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col gap-4 pt-2">
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-0.5">
              <div
                className={cn('grid gap-3', isDesktop ? 'grid-cols-[11rem_1fr]' : 'grid-cols-1')}
              >
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="create-type">Type</Label>
                  <Select value={mode} onValueChange={onModeChange}>
                    <SelectTrigger id="create-type">
                      <SelectValue>
                        {(value) => {
                          const selected = String(value)
                          if (selected === COLLECTION_OPTION) return 'Collection'
                          return itemTypeMeta(selected)?.label ?? selected
                        }}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {CREATABLE_TYPES.map((t) => (
                        <SelectItem key={t.name} value={t.name}>
                          {t.label}
                        </SelectItem>
                      ))}
                      <SelectItem value={COLLECTION_OPTION}>Collection</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="create-title">{isCollection ? 'Name' : 'Title'}</Label>
                  <Input
                    id="create-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={isCollection ? 'e.g. React Patterns' : 'Give it a name'}
                    maxLength={isCollection ? 100 : 200}
                    required
                  />
                </div>
              </div>

              {isCollection ? (
                <div className="flex min-h-0 flex-1 flex-col gap-1.5">
                  <Label htmlFor="create-description">Description</Label>
                  <Textarea
                    id="create-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What goes in this collection?"
                    maxLength={500}
                    className="min-h-24 flex-1"
                  />
                </div>
              ) : (
                <>
                  {mode === 'link' && (
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="create-url">URL</Label>
                      <Input
                        id="create-url"
                        type="url"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder="https://…"
                      />
                    </div>
                  )}

                  <div className="flex min-h-0 flex-1 flex-col gap-1.5">
                    <Label htmlFor="create-content">Content</Label>
                    <Textarea
                      id="create-content"
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      placeholder={
                        mode === 'link' ? 'Notes about this link…' : 'Paste or write here…'
                      }
                      className="min-h-40 flex-1 font-mono text-sm"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="create-tags">Tags</Label>
                    <Input
                      id="create-tags"
                      value={tags}
                      onChange={(e) => setTags(e.target.value)}
                      placeholder="comma, separated, tags"
                      maxLength={500}
                    />
                  </div>
                </>
              )}
            </div>

            <div className="flex shrink-0 justify-end gap-2 border-t border-border pt-3">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {pending ? 'Creating…' : 'Create'}
              </Button>
            </div>
          </form>
        )}
      </ResponsiveFormDialog>
    </>
  )
}
