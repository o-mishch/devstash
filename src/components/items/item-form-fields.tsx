'use client'

import type { ReactNode } from 'react'
import { Controller, type UseFormReturn } from 'react-hook-form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ItemContentInput, LanguageInput } from '@/components/shared/item-content-input'
import { CollectionSelector } from '@/components/shared/collection-selector'
import { DrawerSection } from '@/components/items/drawer/drawer-shared'
import { cn } from '@/lib/utils'
import { ITEM_TYPES_WITH_CONTENT, ITEM_TYPES_WITH_LANGUAGE, ITEM_TYPES_WITH_URL } from '@/lib/utils/constants'
import { type ItemFormBaseValues } from '@/lib/utils/validators'
import type { CollectionPickerItem } from '@/types/collection'
import { AutoDescriptionInput, useAutoDescriptionField } from '@/components/items/auto-description-input'
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
  labelClassName?: string
}

function DialogField({ name, label, error, children, className }: FieldProps) {
  return (
    // grid-cols-1 (minmax(0,1fr)) + min-w-0 so the single column can shrink instead of
    // auto-sizing to the field's max-content (e.g. a nowrap combobox trigger) and overflowing
    // a narrow split column — which got clipped by the wrapper's overflow-hidden.
    <div className={cn('grid grid-cols-1 min-w-0 gap-2', className)}>
      <Label htmlFor={name}>{label}</Label>
      {children}
      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
    </div>
  )
}

function DrawerField({ label, icon, error, children, className, labelClassName }: FieldProps) {
  return (
    <DrawerSection label={label} icon={icon} className={className} labelClassName={labelClassName}>
      {children}
      {error && <p className="text-red-500 text-[10px]">{error}</p>}
    </DrawerSection>
  )
}

export interface ItemFormFieldsProps {
  form: UseFormReturn<ItemFormBaseValues>
  itemContext: ItemFileContext
  watchedLanguage?: string
  collections: CollectionPickerItem[]
  variant?: 'dialog' | 'drawer'
  /**
   * Dialog layout slot — lets the dialog place each field group independently:
   * - `'primary'` — the type-specific primary editor (Content/URL hero)
   * - `'meta'` — Description/Tags/Collections together
   * - `'description'` / `'meta-aside'` — Description and Tags/Collections split apart
   * - `'language'` / `'content'` — the language picker and content editor split apart
   * Omit to render everything (drawer + mobile single-column).
   */
  section?: 'primary' | 'meta' | 'description' | 'meta-aside' | 'language' | 'content'
  /**
   * Dialog only: make the Content editor fill its container height (flex-1)
   * instead of the fixed `h-64`, so it can occupy a full resizable column.
   */
  editorFill?: boolean
}

export function ItemFormFields({
  form,
  itemContext,
  watchedLanguage,
  collections,
  variant = 'dialog',
  section,
  editorFill = false,
}: ItemFormFieldsProps) {
  const { itemType } = itemContext
  const Field = variant === 'drawer' ? DrawerField : DialogField
  const descAiField = useAutoDescriptionField(form, itemContext)
  const showContent = ITEM_TYPES_WITH_CONTENT.has(itemType)
  const showLanguage = ITEM_TYPES_WITH_LANGUAGE.has(itemType)
  const showUrl = ITEM_TYPES_WITH_URL.has(itemType)

  // Content-editor sizing differs by context. Computed as plain branches (not
  // nested ternaries): drawer = fixed 70vh hero; dialog editorFill = flex-fill a
  // resizable column; dialog default = fixed h-64.
  let contentFieldClassName: string | undefined
  let contentEditorClassName: string
  let contentEditorWrapperClassName: string | undefined
  let contentTextareaClassName: string
  if (variant === 'drawer') {
    contentFieldClassName = 'flex flex-col h-[70vh]'
    contentEditorClassName = 'flex-1 min-h-0'
    contentEditorWrapperClassName = 'flex flex-col w-full flex-1 h-0 min-h-[120px]'
    contentTextareaClassName = 'resize-none font-mono text-xs w-full flex-1 h-0 min-h-[120px]'
  } else if (editorFill) {
    contentFieldClassName = 'flex min-h-0 flex-1 flex-col'
    contentEditorClassName = 'flex-1 min-h-0'
    contentEditorWrapperClassName = 'flex flex-col w-full flex-1 h-0 min-h-[160px]'
    contentTextareaClassName = 'resize-none font-mono text-sm w-full flex-1 h-0 min-h-[160px]'
  } else {
    contentFieldClassName = undefined
    contentEditorClassName = 'h-64'
    contentEditorWrapperClassName = undefined
    contentTextareaClassName = 'min-h-[100px] font-mono text-sm'
  }

  const languageField = showLanguage && variant === 'dialog' && (
    <Field name="language" label="Language" error={form.formState.errors.language?.message}>
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
  )

  const contentEditorNode = showContent && (
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
          contentEditorClassName={contentEditorClassName}
          contentEditorWrapperClassName={contentEditorWrapperClassName}
          textareaClassName={contentTextareaClassName}
          enableFullscreen
        />
      )}
    />
  )

  const contentField = showContent && (
    <Field
      name="content"
      label="Content"
      error={form.formState.errors.content?.message}
      // Drawer: mirror the read drawer — hide the Content label on mobile and make
      // the editor a content-dominant 70vh block (all viewports) right under the
      // action bar, so it's the main area and the drawer scrolls to the rest.
      labelClassName={variant === 'drawer' ? 'hidden' : undefined}
      className={contentFieldClassName}
    >
      {contentEditorNode}
    </Field>
  )

  const urlField = showUrl && (
    <Field
      name="url"
      label="URL"
      error={form.formState.errors.url?.message}
      className={variant === 'drawer' ? 'space-y-1.5' : undefined}
    >
      <Input id="url" type="url" placeholder="https://..." {...form.register('url')} />
    </Field>
  )

  const primaryFields = (
    <>
      {languageField}
      {contentField}
      {urlField}
    </>
  )

  const descriptionField = (
    <Field
      name="description"
      label={
        <span className="inline-flex items-center gap-2">
          Description
          <AiFieldBadgeIfPro
            onClick={descAiField.run}
            disabled={descAiField.disabled}
            tooltip={descAiField.tooltip}
          />
        </span>
      }
      error={form.formState.errors.description?.message}
      className={variant === 'drawer' ? 'space-y-1.5' : undefined}
    >
      <AutoDescriptionInput form={form} itemContext={itemContext} variant={variant} aiField={descAiField} />
    </Field>
  )

  const tagsField = (
    <AutoTagInput
      form={form}
      itemContext={itemContext}
      error={form.formState.errors.tags?.message}
      variant={variant}
    />
  )

  const collectionsField = collections.length > 0 && (
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
  )

  const metaFields = (
    <>
      {descriptionField}
      {tagsField}
      {collectionsField}
    </>
  )

  if (section === 'primary') return primaryFields
  if (section === 'meta') return metaFields
  // Snippet/code dialog: Language sits in the left metadata column (under Title), and the right
  // column is just the editor with no "Content" label so it can claim the full area.
  if (section === 'language') return languageField || null
  if (section === 'content') {
    if (!contentEditorNode) return null
    return (
      <div className={contentFieldClassName}>
        {contentEditorNode}
        {form.formState.errors.content && (
          <p className="text-red-500 text-xs mt-1">{form.formState.errors.content.message}</p>
        )}
      </div>
    )
  }
  // File layout splits the metadata: Description on its own (it can grow tall), Tags + Collections
  // stacked beside it.
  if (section === 'description') return descriptionField
  if (section === 'meta-aside') {
    return (
      <>
        {tagsField}
        {collectionsField}
      </>
    )
  }

  return (
    <>
      {primaryFields}
      {metaFields}
    </>
  )
}
