'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { X, Check } from 'lucide-react'
import { toast } from 'sonner'
import { useForm, Controller, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { LanguageInput } from '@/components/shared/item-content-input'
import { ItemFormFields } from '@/components/items/item-form-fields'
import { updateItemAction } from '@/actions/items'
import { DrawerLayout, DrawerDetailsSection } from './drawer-shared'
import { ITEM_TYPES_WITH_LANGUAGE, ITEM_TYPES_WITH_URL } from '@/lib/utils/constants'
import { getDownloadUrl } from '@/lib/utils/url'
import { itemFormBaseSchema } from '@/lib/utils/validators'
import { parseTagString } from '@/lib/utils/format'
import type { FullItem } from '@/types/item'
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
  item: FullItem
  collections: CollectionWithTypes[]
  onClose: () => void
  onSave: (updated: FullItem) => void
  onCancel: () => void
}

export function ItemDrawerEditContent({ item, collections, onClose, onSave, onCancel }: ItemDrawerEditContentProps) {
  const router = useRouter()
  const { itemType } = item
  const typeName = itemType.name

  const formSchema = useMemo(() => createDrawerFormSchema(typeName), [typeName])

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
  
  const showLanguage = ITEM_TYPES_WITH_LANGUAGE.has(typeName)

  const handleSubmit = form.handleSubmit(async (data: DrawerFormValues) => {
    const tagArray = parseTagString(data.tags)

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
    onSave(result.data as FullItem)
  })

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
                      className="h-5 w-32 rounded-full border-border px-2.5 py-0.5 text-xs shadow-none transition-colors hover:bg-accent/50 focus-visible:bg-transparent focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    />
                  )}
                />
                {form.formState.errors.language && (
                  <p className="absolute top-7 left-0 text-red-500 text-[10px] whitespace-nowrap">{form.formState.errors.language.message}</p>
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
          <Button size="sm" onClick={handleSubmit} disabled={saving}>
            <Check className="size-4" />
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <ItemFormFields
        form={form}
        itemContext={{
          itemType: typeName,
          fileName: item.fileName,
          fileSize: item.fileSize,
        }}
        watchedLanguage={watchedLanguage}
        collections={collections}
        variant="drawer"
        imageProbeUrl={
          typeName === 'image' && item.fileUrl ? getDownloadUrl(item.id) : undefined
        }
      />

      <DrawerDetailsSection item={item} />
    </DrawerLayout>
  )
}
