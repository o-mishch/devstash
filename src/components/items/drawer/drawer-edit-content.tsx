import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { X, Check, Tag } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { updateItemAction } from '@/actions/items'
import { DrawerLayout, DrawerSection, DrawerSharedSections } from './drawer-shared'
import type { ItemDetail } from '@/types/item'

const CONTENT_TYPES = new Set(['snippet', 'prompt', 'command', 'note'])
const LANGUAGE_TYPES = new Set(['snippet', 'command'])

interface DrawerEditContentProps {
  item: ItemDetail
  onClose: () => void
  onSave: (updated: ItemDetail) => void
  onCancel: () => void
}

export function DrawerEditContent({ item, onClose, onSave, onCancel }: DrawerEditContentProps) {
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
        <DrawerSection label="Content" className="flex min-h-0 flex-1 flex-col space-y-1.5">
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Content"
            className="flex-1 min-h-0 resize-none font-mono text-xs"
          />
        </DrawerSection>
      )}

      <DrawerSection label="Description" className="space-y-1.5">
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description"
          className="min-h-[3rem] resize-none"
        />
      </DrawerSection>

      {showUrl && (
        <DrawerSection label="URL" className="space-y-1.5">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://..."
            type="url"
          />
        </DrawerSection>
      )}

      <DrawerSection label="Tags" icon={<Tag className="size-3" />} className="space-y-1.5">
        <Input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="react, hooks, typescript"
        />
        <p className="text-xs text-muted-foreground">Comma-separated</p>
      </DrawerSection>

      <DrawerSharedSections item={item} />
    </DrawerLayout>
  )
}
