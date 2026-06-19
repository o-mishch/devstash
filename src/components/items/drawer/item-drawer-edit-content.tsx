'use client'

import { useMemo, useRef } from 'react'
import { X, Check } from 'lucide-react'
import { useForm, Controller, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { LanguageInput } from '@/components/shared/item-content-input'
import { ItemFormFields } from '@/components/items/item-form-fields'
import { UnsavedChangesDialog } from '@/components/shared/unsaved-changes-dialog'
import { useUpdateItem } from '@/hooks/use-update-item'
import { useDirtyGuard } from '@/hooks/use-dirty-guard'
import { useRegisterSheetClose, type SheetCloseRef } from '@/hooks/use-register-sheet-close'
import { DrawerLayout, DrawerDetailsSection } from './drawer-shared'
import { ITEM_TYPES_WITH_LANGUAGE, ITEM_TYPES_WITH_URL } from '@/lib/utils/constants'
import { itemFormBaseSchema } from '@/lib/utils/validators'
import { parseTagString } from '@/lib/utils/format'
import type { FullItem } from '@/types/item'
import type { CollectionPickerItem } from '@/types/collection'

const createDrawerFormSchema = (itemType: string) => itemFormBaseSchema.superRefine((data, ctx) => {
  if (ITEM_TYPES_WITH_URL.has(itemType)) {
    if (!data.url) {
      ctx.addIssue({
        code: 'custom',
        message: 'URL is required for this item type',
        path: ['url'],
      })
    } else {
      const urlParsed = z.string().url().safeParse(data.url)
      if (!urlParsed.success) {
        ctx.addIssue({
          code: 'custom',
          message: 'Must be a valid URL',
          path: ['url'],
        })
      }
    }
  }
})

type DrawerFormValues = z.infer<ReturnType<typeof createDrawerFormSchema>>

interface ItemDrawerEditContentProps {
  item: FullItem
  collections: CollectionPickerItem[]
  onClose: () => void
  onSave: (updated: FullItem) => void
  onCancel: () => void
  /**
   * Ref that this component writes its guarded-close handler into. The parent
   * Sheet reads it on Esc/backdrop so those paths also go through the dirty guard.
   */
  sheetCloseRef?: SheetCloseRef
}

export function ItemDrawerEditContent({ item, collections, onClose, onSave, onCancel, sheetCloseRef }: ItemDrawerEditContentProps) {
  const { itemType } = item
  const typeName = itemType.name
  const updateItem = useUpdateItem()

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
  const isDirty = form.formState.isDirty

  const showLanguage = ITEM_TYPES_WITH_LANGUAGE.has(typeName)

  // X button closes the whole drawer; Cancel returns to view mode. Both need
  // the same dirty guard, so a ref tracks which action to run on confirm.
  const pendingActionRef = useRef<(() => void)>(onCancel)
  const { confirmOpen, handleConfirmOpenChange, handleDiscard, handleOpenChange } = useDirtyGuard({
    isDirty,
    onClose: () => pendingActionRef.current(),
  })

  function guardedAction(action: () => void) {
    pendingActionRef.current = action
    handleOpenChange(false)
  }

  // Expose guarded-close to the parent Sheet so Esc/backdrop go through the guard too.
  // Cleared on unmount so view-mode Esc closes normally.
  useRegisterSheetClose(sheetCloseRef, () => guardedAction(onClose))

  const handleSubmit = form.handleSubmit(async (data: DrawerFormValues) => {
    const tagArray = parseTagString(data.tags)
    await updateItem(
      item,
      {
        title: data.title.trim(),
        description: data.description?.trim() || null,
        content: data.content || null,
        url: data.url?.trim() || null,
        language: data.language?.trim() || null,
        tags: tagArray,
        collectionIds: data.collectionIds,
      },
      { onSave },
    )
  })

  return (
    <>
      <DrawerLayout
        itemType={itemType}
        onClose={() => guardedAction(onClose)}
        titleArea={
          <>
            <div className="relative w-full">
              <Textarea
                {...form.register('title')}
                placeholder="Item title"
                rows={1}
                // touch:min-h-0 cancels the Textarea primitive's touch upsize so this inline
                // title stays as compact as the read drawer's h2 (no downward shift in edit mode).
                className="-my-1 min-h-0 touch:min-h-0 w-full resize-none border-transparent bg-transparent px-2 py-1 -ml-2 text-base font-semibold leading-snug shadow-none transition-colors hover:bg-accent/50 focus-visible:border-ring focus-visible:bg-transparent focus-visible:ring-2 focus-visible:ring-ring/50 max-sm:text-sm"
              />
              {form.formState.errors.title && (
                <p className="absolute -bottom-5 left-0 text-red-500 text-[10px]">{form.formState.errors.title.message}</p>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 max-sm:mt-1">
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
                        className="h-5 touch:h-5 w-32 rounded-full border-border px-2.5 py-0.5 text-xs shadow-none transition-colors hover:bg-accent/50 focus-visible:bg-transparent focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
            {/* touch:h-11 matches the view action bar's height (its Delete button is a 44px
                touch target), so the content editor sits at the same vertical position in both modes. */}
            <Button variant="outline" size="sm" onClick={() => guardedAction(onCancel)} disabled={saving} className="touch:h-11">
              <X className="size-4" />
              Cancel
            </Button>
            <Button size="sm" onClick={handleSubmit} disabled={saving} className="touch:h-11">
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
        />

        <DrawerDetailsSection item={item} />
      </DrawerLayout>
      <UnsavedChangesDialog
        open={confirmOpen}
        onOpenChange={handleConfirmOpenChange}
        onDiscard={handleDiscard}
      />
    </>
  )
}
