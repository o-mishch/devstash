'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { createItemAction } from '@/actions/items'
import { ItemTypeIcon } from '@/components/shared/item-type-icon'
import { ITEM_TYPES_WITH_CONTENT, ITEM_TYPES_WITH_LANGUAGE, ITEM_TYPES_WITH_URL } from '@/lib/utils/constants'
import type { SidebarItemType } from '@/types/item'

export function CreateItemDialog({ itemTypes }: { itemTypes: SidebarItemType[] }) {
  const router = useRouter()
  const defaultItemType = itemTypes[0]?.name || ''

  const [open, setOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [itemType, setItemType] = useState(defaultItemType)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [content, setContent] = useState('')
  const [url, setUrl] = useState('')
  const [language, setLanguage] = useState('')
  const [tags, setTags] = useState('')

  function handleOpenChange(isOpen: boolean) {
    setOpen(isOpen)
    if (isOpen) {
      setItemType(defaultItemType)
      setTitle('')
      setDescription('')
      setContent('')
      setUrl('')
      setLanguage('')
      setTags('')
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setIsSubmitting(true)

    const tagArray = tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)

    const result = await createItemAction({
      title,
      description,
      content,
      url,
      language,
      tags: tagArray,
      itemTypeName: itemType,
    })

    setIsSubmitting(false)

    if (result.status === 'created' || result.status === 'ok') {
      toast.success('Item created successfully')
      setOpen(false)
      router.refresh()
    } else {
      toast.error(result.message || 'Failed to create item')
    }
  }

  const showContent = ITEM_TYPES_WITH_CONTENT.has(itemType)
  const showLanguage = ITEM_TYPES_WITH_LANGUAGE.has(itemType)
  const showUrl = ITEM_TYPES_WITH_URL.has(itemType)

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button size="icon" className="sm:hidden"><Plus className="size-4" /></Button>} />
      <DialogTrigger render={<Button size="sm" className="hidden sm:flex"><Plus className="size-4" />New Item</Button>} />
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create New Item</DialogTitle>
            <DialogDescription>
              Add a new item to your stash.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            
            <div className="grid gap-2">
              <Label htmlFor="type">Type</Label>
              <Select value={itemType} onValueChange={(val) => val && setItemType(val)}>
                <SelectTrigger id="type">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {itemTypes.map((type) => (
                    <SelectItem key={type.id} value={type.name}>
                      <div className="flex items-center gap-2">
                        <ItemTypeIcon iconName={type.icon} color={type.color} className="size-4" />
                        <span className="capitalize">{type.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="title">Title <span className="text-red-500">*</span></Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Item title"
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description"
              />
            </div>

            {showUrl && (
              <div className="grid gap-2">
                <Label htmlFor="url">URL <span className="text-red-500">*</span></Label>
                <Input
                  id="url"
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com"
                  required={showUrl}
                />
              </div>
            )}

            {showLanguage && (
              <div className="grid gap-2">
                <Label htmlFor="language">Language</Label>
                <Input
                  id="language"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  placeholder="e.g. typescript, bash"
                />
              </div>
            )}

            {showContent && (
              <div className="grid gap-2">
                <Label htmlFor="content">Content</Label>
                <Textarea
                  id="content"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Paste your content here..."
                  className="min-h-[100px] font-mono text-sm"
                />
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="tags">Tags</Label>
              <Input
                id="tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="react, hooks, frontend (comma separated)"
              />
            </div>

          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || !title || (showUrl && !url)}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Item
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
