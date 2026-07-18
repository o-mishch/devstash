import { useState } from 'react'
import type { ReactNode, SyntheticEvent } from 'react'
import type { LightItem } from '@/client'
import { itemTypeMeta, typeHasCodeEditor, typeHasContent } from '@/lib/item-types'
import { normalizeColorMode } from '@/lib/theme'
import { useUpdateItem } from '@/hooks/use-items'
import { useEditorPreferences } from '@/hooks/use-preferences'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { LazyCodeEditor } from './code-editor-lazy'

// The backend only accepts these four text type names on update; they can be re-typed among each
// other (matches UpdateItem's source-type guard). file/image/link keep their type.
type UpdateItemType = 'snippet' | 'prompt' | 'command' | 'note'
const RETYPEABLE: readonly UpdateItemType[] = ['snippet', 'prompt', 'command', 'note']

interface ItemDrawerEditProps {
  item: LightItem
  description: string | null
  content: string | null
  language: string | null
  onSaved: () => void
  onCancel: () => void
}

/** Inline edit pane of the item drawer: title, type, content (code editor), description, url, tags. */
export function ItemDrawerEdit({
  item,
  description,
  content,
  language,
  onSaved,
  onCancel,
}: ItemDrawerEditProps): ReactNode {
  const { data: prefs } = useEditorPreferences()
  const colorMode = normalizeColorMode(prefs?.colorMode)
  const update = useUpdateItem()

  const [title, setTitle] = useState(item.title)
  const [type, setType] = useState<string>(item.itemType.name)
  const [draftContent, setDraftContent] = useState(content ?? '')
  const [draftDescription, setDraftDescription] = useState(description ?? '')
  const [url, setUrl] = useState(item.url ?? '')
  const [tags, setTags] = useState((item.tags ?? []).join(', '))

  const hasContent = typeHasContent(type)
  const isRetypeable = RETYPEABLE.some((t) => t === item.itemType.name)

  const onSubmit = (e: SyntheticEvent<HTMLFormElement>): void => {
    e.preventDefault()
    const trimmedTitle = title.trim()
    if (trimmedTitle.length === 0) return
    const tagList = tags
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0)

    update.mutate(
      {
        path: { id: item.id },
        body: {
          title: trimmedTitle,
          itemTypeName: RETYPEABLE.find((t) => t === type),
          content: hasContent ? draftContent : undefined,
          description: draftDescription.trim() || undefined,
          url: item.itemType.name === 'link' ? url.trim() || undefined : undefined,
          tags: tagList,
        },
      },
      { onSuccess: onSaved },
    )
  }

  return (
    <form onSubmit={onSubmit} className="flex h-full flex-col">
      <div className="border-b border-border p-5 pr-14">
        <p className="font-mono text-[0.65rem] uppercase tracking-widest text-muted-foreground">
          Editing
        </p>
        <h2 className="mt-1 text-lg font-semibold">{item.title}</h2>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-title">Title</Label>
          <Input
            id="edit-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            required
          />
        </div>

        {isRetypeable && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-type">Type</Label>
            <select
              id="edit-type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {RETYPEABLE.map((t) => (
                <option key={t} value={t}>
                  {itemTypeMeta(t)?.label ?? t}
                </option>
              ))}
            </select>
          </div>
        )}

        {item.itemType.name === 'link' && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-url">URL</Label>
            <Input
              id="edit-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
            />
          </div>
        )}

        {hasContent && (
          <div className="flex flex-col gap-1.5">
            <Label>Content</Label>
            <LazyCodeEditor
              value={draftContent}
              onChange={setDraftContent}
              language={typeHasCodeEditor(type) ? language : null}
              colorMode={colorMode}
              fontSize={prefs?.fontSize ?? 14}
              tabSize={prefs?.tabSize ?? 2}
              wordWrap={prefs?.wordWrap === 'on'}
              minHeight="12rem"
            />
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-description">Description</Label>
          <Textarea
            id="edit-description"
            value={draftDescription}
            onChange={(e) => setDraftDescription(e.target.value)}
            placeholder="Optional notes about this item"
            rows={3}
            maxLength={2000}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-tags">Tags</Label>
          <Input
            id="edit-tags"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="comma, separated, tags"
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border p-3">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={update.isPending || title.trim().length === 0}>
          {update.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  )
}
