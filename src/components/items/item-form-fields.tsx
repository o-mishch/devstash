'use client'

import { ReactNode } from 'react'
import { Controller, type UseFormReturn } from 'react-hook-form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ItemContentInput, LanguageInput } from '@/components/shared/item-content-input'
import { CollectionSelector } from '@/components/shared/collection-selector'
import { DrawerSection } from '@/components/items/drawer/drawer-shared'
import { cn } from '@/lib/utils'
import { ITEM_TYPES_WITH_CONTENT, ITEM_TYPES_WITH_LANGUAGE, ITEM_TYPES_WITH_URL } from '@/lib/utils/constants'
import { type ItemFormBaseValues } from '@/lib/utils/validators'
import type { CollectionWithTypes } from '@/types/collection'
import { AutoDescriptionInput } from '@/components/items/auto-description-input'
import { AutoTagInput } from '@/components/items/auto-tag-input'
import { AiFieldBadgeIfPro } from '@/components/shared/ai-field-chrome'
import type { ItemFileContext } from '@/lib/ai/item-context'

interface FieldProps {
  name: string
  label: ReactNode
  icon?: ReactNode
  error?: string
  children: ReactNode
  className?: string
}

function DialogField({ name, label, error, children, className }: FieldProps) {
  return (
    <div className={cn('grid gap-2', className)}>
      <Label htmlFor={name}>{label}</Label>
      {children}
      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
    </div>
  )
}

function DrawerField({ label, icon, error, children, className }: FieldProps) {
  return (
    <DrawerSection label={label} icon={icon} className={className}>
      {children}
      {error && <p className="text-red-500 text-[10px]">{error}</p>}
    </DrawerSection>
  )
}

export interface ItemFormFieldsProps {
  form: UseFormReturn<ItemFormBaseValues>
  itemContext: ItemFileContext
  watchedLanguage?: string
  collections: CollectionWithTypes[]
  variant?: 'dialog' | 'drawer'
  imageProbeUrl?: string | null
}

export function ItemFormFields({
  form,
  itemContext,
  watchedLanguage,
  collections,
  variant = 'dialog',
  imageProbeUrl,
}: ItemFormFieldsProps) {
  const { itemType } = itemContext
  const Field = variant === 'drawer' ? DrawerField : DialogField
  const showContent = ITEM_TYPES_WITH_CONTENT.has(itemType)
  const showLanguage = ITEM_TYPES_WITH_LANGUAGE.has(itemType)
  const showUrl = ITEM_TYPES_WITH_URL.has(itemType)

  return (
    <>
      {showLanguage && variant === 'dialog' && (
        <Field
          name="language"
          label="Language"
          error={form.formState.errors.language?.message}
        >
          <Controller
            control={form.control}
            name="language"
            render={({ field }) => (
              <LanguageInput
                id="language"
                value={field.value || ''}
                onChange={field.onChange}
                placeholder="Select language..."
              />
            )}
          />
        </Field>
      )}

      {showContent && (
        <Field
          name="content"
          label="Content"
          error={form.formState.errors.content?.message}
          className={variant === 'drawer' ? 'flex flex-col flex-1 min-h-0 space-y-1.5' : undefined}
        >
          <Controller
            control={form.control}
            name="content"
            render={({ field }) => (
              <ItemContentInput
                id={variant === 'dialog' ? 'content' : undefined}
                itemType={itemType}
                value={field.value || ''}
                onChange={field.onChange}
                language={watchedLanguage}
                placeholder={variant === 'drawer' ? 'Content' : 'Paste your content here...'}
                contentEditorClassName={variant === 'drawer' ? 'flex-1 min-h-0' : 'h-64'}
                contentEditorWrapperClassName={variant === 'drawer' ? 'flex flex-col w-full flex-1 h-0 min-h-[120px]' : undefined}
                textareaClassName={variant === 'drawer' ? 'resize-none font-mono text-xs w-full flex-1 h-0 min-h-[120px]' : 'min-h-[100px] font-mono text-sm'}
              />
            )}
          />
        </Field>
      )}

      {showUrl && (
        <Field
          name="url"
          label="URL"
          error={form.formState.errors.url?.message}
          className={variant === 'drawer' ? 'space-y-1.5' : undefined}
        >
          <Input
            id="url"
            type="url"
            placeholder="https://..."
            {...form.register('url')}
          />
        </Field>
      )}

      <Field
        name="description"
        label={
          <span className="inline-flex items-center gap-2">
            Description
            <AiFieldBadgeIfPro />
          </span>
        }
        error={form.formState.errors.description?.message}
        className={variant === 'drawer' ? 'space-y-1.5' : undefined}
      >
        <AutoDescriptionInput
          form={form}
          itemContext={itemContext}
          imageProbeUrl={imageProbeUrl}
          variant={variant}
        />
      </Field>

      <AutoTagInput
        form={form}
        itemContext={itemContext}
        error={form.formState.errors.tags?.message}
        variant={variant}
        imageProbeUrl={imageProbeUrl}
      />

      {collections.length > 0 && (
        <Field
          name="collectionIds"
          label="Collections"
          error={form.formState.errors.collectionIds?.message}
          className={variant === 'drawer' ? 'space-y-1.5' : undefined}
        >
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
        </Field>
      )}
    </>
  )
}
