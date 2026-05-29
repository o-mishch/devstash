'use client'

import { type SyntheticEvent } from 'react'
import { useRouter } from 'next/navigation'
import { X, Check, Tag } from 'lucide-react'
import { toast } from 'sonner'
import { useForm, Controller, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { CollectionSelector } from '@/components/shared/collection-selector'
import { ItemContentInput, LanguageInput } from '@/components/shared/item-content-input'
import { updateItemAction } from '@/actions/items'
import { DrawerLayout, DrawerSection, DrawerSharedSections } from './drawer-shared'
import { ITEM_TYPES_WITH_CONTENT, ITEM_TYPES_WITH_LANGUAGE, ITEM_TYPES_WITH_URL } from '@/lib/utils/constants'
import { itemFormBaseSchema } from '@/lib/utils/validators'
import type { Item } from '@/types/item'
import type { CollectionWithTypes } from '@/types/collection'

const createDrawerFormSchema = (itemType: string) => itemFormBaseSchema.superRefine((data, ctx) => {
  if (ITEM_TYPES_WITH_URL.has(itemType) && !data.url) {
    ctx.addIssue({
      code: 'custom',
      message: 'URL is required for this item type',
      path: ['url'],
    })
  }
})

type DrawerFormValues = z.infer<ReturnType<typeof createDrawerFormSchema>>

interface ItemDrawerEditContentProps {
  item: Item
  collections: CollectionWithTypes[]
  onClose: () => void
  onSave: (updated: Item) => void
  onCancel: () => void
}

export function ItemDrawerEditContent({ item, collections, onClose, onSave, onCancel }: ItemDrawerEditContentProps) {
  const router = useRouter()
  const { itemType } = item
  const typeName = itemType.name

  const formSchema = createDrawerFormSchema(typeName)

  const form = useForm<DrawerFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: item.title,
      description: item.description ?? '',
      content: item.content ?? '',
      url: item.url ?? '',
      language: item.language ?? '',
      tags: item.tags.join(', '),
      collectionIds: item.collections.map((c) => c.id),
    }
  })

  const watchedLanguage = useWatch({ control: form.control, name: 'language' })
  const saving = form.formState.isSubmitting

  const showContent = ITEM_TYPES_WITH_CONTENT.has(typeName)
  const showLanguage = ITEM_TYPES_WITH_LANGUAGE.has(typeName)
  const showUrl = ITEM_TYPES_WITH_URL.has(typeName)

  const handleFormSubmit = async (e: SyntheticEvent) => {
    e.preventDefault()
    void form.handleSubmit(async (data: DrawerFormValues) => {
      const tagArray = (data.tags || '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)

      const result = await updateItemAction(item.id, {
        title: data.title.trim(),
        description: data.description?.trim() || null,
        content: data.content || null,
        url: data.url?.trim() || null,
        language: data.language?.trim() || null,
        tags: tagArray,
        collectionIds: data.collectionIds,
      })

      if (result.status !== 'ok' || !result.data) {
        toast.error(result.message ?? 'Failed to save item')
        return
      }

      toast.success('Item saved')
      router.refresh()
      onSave(result.data)
    })(e)
  }

  return (
    <DrawerLayout
      itemType={itemType}
      onClose={onClose}
      titleArea={
        <>
          <div className="relative w-full">
            <Textarea
              {...form.register('title')}
              placeholder="Item title"
              rows={1}
              className="-my-1 min-h-0 w-full resize-none border-transparent bg-transparent px-2 py-1 -ml-2 text-base font-semibold leading-snug shadow-none transition-colors hover:bg-accent/50 focus-visible:border-ring focus-visible:bg-transparent focus-visible:ring-2 focus-visible:ring-ring/50"
            />
            {form.formState.errors.title && (
              <p className="absolute -bottom-5 left-0 text-red-500 text-[10px]">{form.formState.errors.title.message}</p>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="capitalize">{typeName}</Badge>
            {showLanguage && (
              <div className="relative">
                <Controller
                  control={form.control}
                  name="language"
                  render={({ field }) => (
                    <LanguageInput
                      id="drawer-language"
                      value={field.value || ''}
                      onChange={field.onChange}
                      placeholder="Language"
                      className="h-5 w-24 rounded-md border-border/60 px-1.5 py-0 text-xs shadow-none transition-colors hover:bg-accent/50 focus-visible:bg-transparent focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                    />
                  )}
                />
                {form.formState.errors.language && (
                  <p className="absolute top-6 left-0 text-red-500 text-[10px] whitespace-nowrap">{form.formState.errors.language.message}</p>
                )}
              </div>
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
          <Button size="sm" onClick={handleFormSubmit} disabled={saving}>
            <Check className="size-4" />
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <form id="drawer-edit-form" onSubmit={handleFormSubmit} className="contents">
        {showContent && (
          <DrawerSection label="Content" className="flex min-h-0 flex-1 flex-col space-y-1.5">
            <Controller
              control={form.control}
              name="content"
              render={({ field }) => (
                <ItemContentInput
                  itemType={typeName}
                  value={field.value || ''}
                  onChange={field.onChange}
                  language={watchedLanguage}
                  placeholder="Content"
                  contentEditorClassName="h-full"
                  contentEditorWrapperClassName="flex-1 min-h-[200px]"
                  textareaClassName="flex-1 min-h-0 resize-none font-mono text-xs"
                />
              )}
            />
            {form.formState.errors.content && <p className="text-red-500 text-[10px]">{form.formState.errors.content.message}</p>}
          </DrawerSection>
        )}

        <DrawerSection label="Description" className="space-y-1.5">
          <Textarea
            {...form.register('description')}
            placeholder="Optional description"
            className="min-h-[3rem] resize-none"
          />
          {form.formState.errors.description && <p className="text-red-500 text-[10px]">{form.formState.errors.description.message}</p>}
        </DrawerSection>

        {showUrl && (
          <DrawerSection label="URL" className="space-y-1.5">
            <Input
              {...form.register('url')}
              placeholder="https://..."
              type="url"
            />
            {form.formState.errors.url && <p className="text-red-500 text-[10px]">{form.formState.errors.url.message}</p>}
          </DrawerSection>
        )}

        <DrawerSection label="Tags" icon={<Tag className="size-3" />} className="space-y-1.5">
          <Input
            {...form.register('tags')}
            placeholder="react, hooks, typescript"
          />
          <p className="text-xs text-muted-foreground">Comma-separated</p>
          {form.formState.errors.tags && <p className="text-red-500 text-[10px]">{form.formState.errors.tags.message}</p>}
        </DrawerSection>

        {collections.length > 0 && (
          <DrawerSection label="Collections" className="space-y-1.5">
            <Controller
              control={form.control}
              name="collectionIds"
              render={({ field }) => (
                <CollectionSelector
                  collections={collections}
                  selectedIds={field.value}
                  onChange={field.onChange}
                />
              )}
            />
            {form.formState.errors.collectionIds && <p className="text-red-500 text-[10px]">{form.formState.errors.collectionIds.message}</p>}
          </DrawerSection>
        )}

        <DrawerSharedSections item={item} />
      </form>
    </DrawerLayout>
  )
}
