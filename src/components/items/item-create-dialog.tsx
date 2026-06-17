'use client'

import { useRef, useState, type SyntheticEvent, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'

import { Badge } from '@/components/ui/badge'
import { Button, SubmitButton } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ItemFormFields } from '@/components/items/item-form-fields'
import { ResizableSplit } from '@/components/items/resizable-split'
import { FileUpload, type UploadedFile } from '@/components/shared/file-upload'
import { DialogFooter } from '@/components/ui/dialog'
import { FormDialogFooter } from '@/components/shared/form-dialog-footer'
import { ResponsiveFormDialog } from '@/components/ui/responsive-form-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'

import { useCreateItem } from '@/hooks/use-create-item'
import { api } from '@/lib/api/client'
import { ItemTypeIcon } from '@/components/shared/item-type-icon'
import { ITEM_TYPES_WITH_URL, ITEM_TYPES_WITH_FILE, ITEM_TYPES_WITH_CONTENT, PRO_ITEM_TYPE_NAMES, FREE_TIER_ITEM_LIMIT, type FileItemType } from '@/lib/utils/constants'
import { useUpgradePromptStore } from '@/stores/upgrade-prompt'
import { useAppUserFlagsStore } from '@/stores/app-user-flags'

import { itemFormBaseSchema, type ItemFormBaseValues } from '@/lib/utils/validators'
import { parseTagString } from '@/lib/utils/format'
import { cn } from '@/lib/utils'
import { useControllableOpen } from '@/hooks/use-controllable-open'
import { useSelectTouchSwipe } from '@/hooks/use-select-touch-swipe'
import type { SidebarItemType } from '@/types/item'
import type { CollectionPickerItem } from '@/types/collection'

async function deleteOrphanedFile(file: UploadedFile): Promise<void> {
  await api.DELETE('/upload', { params: { query: { key: file.key } } })
}

interface CreateItemDialogProps {
  itemTypes: SidebarItemType[]
  collections: CollectionPickerItem[]
  initialType?: string
  initialCollectionId?: string
  trigger?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function CreateItemDialog({ itemTypes, collections, initialType, initialCollectionId, trigger, open: controlledOpen, onOpenChange: controlledOnOpenChange }: CreateItemDialogProps) {
  const createItem = useCreateItem()
  const { isPro, canCreateItem } = useAppUserFlagsStore()
  const { openPrompt } = useUpgradePromptStore()
  const validInitialType = (initialType && PRO_ITEM_TYPE_NAMES.has(initialType) && !isPro) ? itemTypes[0]?.name : initialType
  const defaultItemType = validInitialType || itemTypes[0]?.name || ''

  const [itemType, setItemType] = useState(defaultItemType)
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const savedRef = useRef(false)

  const form = useForm<ItemFormBaseValues>({
    resolver: zodResolver(itemFormBaseSchema),
    defaultValues: {
      title: '',
      description: '',
      content: '',
      url: '',
      language: '',
      tags: '',
      collectionIds: initialCollectionId ? [initialCollectionId] : [],
    }
  })

  const watchedLanguage = useWatch({ control: form.control, name: 'language' })
  const showFile = ITEM_TYPES_WITH_FILE.has(itemType)
  const showContentEditor = ITEM_TYPES_WITH_CONTENT.has(itemType)
  const selectedType = itemTypes.find(t => t.name === itemType)

  const { open, handleOpenChange } = useControllableOpen({
    open: controlledOpen,
    onOpenChange: (isOpen) => {
      controlledOnOpenChange?.(isOpen)
      if (isOpen) setItemType(defaultItemType)
    },
    onClose: () => {
      if (uploadedFile && !savedRef.current) deleteOrphanedFile(uploadedFile)
      savedRef.current = false
      setUploadedFile(null)
      setFileError(null)
      form.reset({ title: '', description: '', content: '', url: '', language: '', tags: '', collectionIds: initialCollectionId ? [initialCollectionId] : [] })
    }
  })

  function handleTypeChange(val: string | null) {
    if (!val) return
    if (PRO_ITEM_TYPE_NAMES.has(val) && !isPro) {
      openPrompt({ title: 'Pro feature', description: 'File and image uploads are only available on the Pro plan.', onUpgrade: () => handleOpenChange(false) })
      return
    }
    setItemType(val)
    setFileError(null)
    form.clearErrors()
  }

  const handleFormSubmit = (e: SyntheticEvent) => {
    e.preventDefault()
    void form.handleSubmit(async (data: ItemFormBaseValues) => {
      if (ITEM_TYPES_WITH_URL.has(itemType) && !data.url) {
        form.setError('url', { message: 'URL is required for this item type' })
        return
      }
      if (ITEM_TYPES_WITH_FILE.has(itemType) && !uploadedFile) {
        setFileError('File is required for this item type')
        return
      }

      const tagArray = parseTagString(data.tags)
      const capturedFile = uploadedFile

      savedRef.current = true
      handleOpenChange(false)

      await createItem(
        {
          title: data.title,
          description: data.description || null,
          content: data.content || null,
          url: data.url || null,
          language: data.language || null,
          tags: tagArray,
          itemTypeName: itemType,
          fileUrl: capturedFile?.key ?? null,
          imageWidth: capturedFile?.imageWidth ?? null,
          imageHeight: capturedFile?.imageHeight ?? null,
          collectionIds: data.collectionIds,
        },
        {
          onRollback: capturedFile ? () => deleteOrphanedFile(capturedFile) : undefined,
          localPreviewUrl: capturedFile?.localPreviewUrl,
          optimisticFileName: capturedFile?.fileName ?? null,
          optimisticFileSize: capturedFile?.fileSize ?? null,
        }
      )
    })(e)
  }

  const triggerEl = trigger ?? (
    <Button size="sm" data-create-item-trigger>
      <Plus className="size-4" />
      <span className="hidden sm:inline">New Item</span>
    </Button>
  )

  const descriptionNode = (
    <>Add a new item to your stash. <span className="text-red-500/80">*</span> Indicates a required field.</>
  )

  const itemContext = {
    itemType,
    ...(uploadedFile ? { fileName: uploadedFile.fileName, fileSize: uploadedFile.fileSize } : {}),
  }
  const fieldProps = { form, itemContext, watchedLanguage, collections, variant: 'dialog' as const }

  const typeSwipe = useSelectTouchSwipe()

  const typeField = (
    <div className="grid gap-2">
      <Label htmlFor="type">Type</Label>
      <Select value={itemType} onValueChange={handleTypeChange}>
        <SelectTrigger id="type" className="w-full">
          {itemType ? (
            <div className="flex items-center gap-2">
              <ItemTypeIcon
                iconName={selectedType?.icon || ''}
                color={selectedType?.color || ''}
                className="size-4"
              />
              <span className="capitalize">{itemType}</span>
              {PRO_ITEM_TYPE_NAMES.has(itemType) && (
                <Badge variant="outline" className="h-4 px-1 text-[10px] font-semibold text-muted-foreground/60">PRO</Badge>
              )}
            </div>
          ) : (
            <span className="text-muted-foreground">Select type</span>
          )}
        </SelectTrigger>
        {/* alignItemWithTrigger={false}: base-ui's default overlap-align mode positions the popup
            over the trigger and scrolls/repositions to align the selected item. Inside a mobile
            bottom sheet that align math drives the viewport scroll + horizontal reflow seen when
            reopening the select. A plain dropdown-below-trigger avoids it. */}
        <SelectContent alignItemWithTrigger={false} {...typeSwipe}>
          {itemTypes.map((type) => (
            <SelectItem key={type.id} value={type.name}>
              <div className="flex items-center gap-2">
                <ItemTypeIcon iconName={type.icon} color={type.color} className="size-4" />
                <span className="capitalize">{type.name}</span>
                {PRO_ITEM_TYPE_NAMES.has(type.name) && (
                  <Badge variant="outline" className="h-4 px-1 text-[10px] font-semibold text-muted-foreground/60">PRO</Badge>
                )}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )

  const titleField = (
    <div className="grid gap-2">
      <Label htmlFor="title">Title <span className="text-red-500">*</span></Label>
      <Input id="title" placeholder="Item title" {...form.register('title')} />
      {form.formState.errors.title && <p className="text-red-500 text-xs mt-1">{form.formState.errors.title.message}</p>}
    </div>
  )

  const fileField = showFile ? (
    <div className="grid gap-2">
      <Label>File</Label>
      <FileUpload
        itemType={itemType as FileItemType}
        value={uploadedFile}
        onUpload={(file) => {
          if (uploadedFile) deleteOrphanedFile(uploadedFile)
          setUploadedFile(file)
          setFileError(null)
        }}
        onClear={() => {
          if (uploadedFile) deleteOrphanedFile(uploadedFile)
          setUploadedFile(null)
        }}
      />
      {fileError && <p className="text-red-500 text-xs mt-1">{fileError}</p>}
    </div>
  ) : null

  // Per-type desktop layout:
  // • image → two columns: the uploaded image preview fills the left, metadata on the right.
  // • file → dropzone full-width on top (no preview to justify a tall left column), with the
  //   Description / Tags / Collections metadata in a row beneath it.
  // • snippet / command / prompt / note → two resizable columns: all metadata
  //   (Type, Title, Description, Tags, Collections) on the left, the Language +
  //   full-height content editor occupying the entire right column.
  // • link → the URL primary input spans the full width as the hero, with the
  //   Description / Tags / Collections metadata laid out in a row beneath it.
  const imageTypeBody = (
    <div className="grid gap-6 sm:grid-cols-[1.4fr_1fr]">
      <div className="grid content-start gap-6">{fileField}</div>
      <div className="grid content-start gap-6">
        <ItemFormFields {...fieldProps} section="meta" />
      </div>
    </div>
  )

  const fileTypeBody = (
    <>
      {fileField}
      {/* Description on the left (it can grow tall); Tags + Collections stacked on the right.
          items-start so the right column never stretches to the Description's height. */}
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 sm:items-start">
        <ItemFormFields {...fieldProps} section="description" />
        <div className="grid content-start gap-4">
          <ItemFormFields {...fieldProps} section="meta-aside" />
        </div>
      </div>
    </>
  )

  const heroBody = (
    <>
      <ItemFormFields {...fieldProps} section="primary" />
      <div className="grid gap-4 sm:grid-cols-3">
        <ItemFormFields {...fieldProps} section="meta" />
      </div>
    </>
  )

  let typeSpecificBody: ReactNode
  if (itemType === 'image') {
    typeSpecificBody = imageTypeBody
  } else if (showFile) {
    typeSpecificBody = fileTypeBody
  } else {
    typeSpecificBody = heroBody
  }

  // Content types fill the dialog height and let the editor own the right column;
  // the divider between the two columns is draggable (and keyboard-resizable).
  const contentSplitBody = (
    // The whole body scrolls as one block (consistent with the file/link layouts), so scrolling
    // works anywhere — not just over the narrow metadata column. The editor is a tall fixed-height
    // box (definite height so the fill machinery resolves); the metadata column sits beside it.
    <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-1 py-3 scrollbar-thin">
      <ResizableSplit
        // Row has a tall minimum (so the editor is generous even when metadata is short) and
        // stretches to whichever column is taller. The editor flex-fills the row, so it always
        // takes the full parent height; the whole body scrolls when the row exceeds the dialog.
        className="min-h-[clamp(300px,52vh,600px)]"
        ariaLabel="Resize form columns"
        // Default the divider to the left edge so the editor claims the maximum area by default.
        defaultLeftPct={32}
        minLeftPct={28}
        maxLeftPct={60}
        left={
          <div className="flex min-w-0 flex-col gap-4 pr-1">
            {typeField}
            {titleField}
            {/* Language lives here (under Title), so the right column is purely the editor. */}
            <ItemFormFields {...fieldProps} section="language" />
            <ItemFormFields {...fieldProps} section="meta" />
          </div>
        }
        right={
          <div className="flex min-h-0 flex-1 flex-col pl-1">
            <ItemFormFields {...fieldProps} section="content" editorFill />
          </div>
        }
      />
    </div>
  )

  const standardDesktopBody = (
    // overflow-x-hidden: kill the horizontal scrollbar that overflow-y-auto otherwise allows.
    // Symmetric px-1 (not px-1 pr-3) so the fields line up evenly under the header and above the
    // footer instead of being shifted in further on the right.
    <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden grid gap-6 py-5 px-1 scrollbar-thin">
      <div className="grid gap-4 sm:grid-cols-2">
        {typeField}
        {titleField}
      </div>
      {typeSpecificBody}
    </div>
  )

  const desktopBody = showContentEditor ? contentSplitBody : standardDesktopBody

  const mobileBody = (
    // Dense mobile form: tighter gaps + one consistent, compact 40px height for the single-line
    // controls (Type select, Title/URL/Tags inputs) — scoped here so it overrides each control's
    // own touch height without touching the shared components. Keeps the sheet area efficient.
    <div className="flex-1 min-h-0 overflow-y-auto grid gap-3 py-3 px-0.5 scrollbar-thin [&_[data-slot=input]]:h-10 [&_[data-slot=select-trigger]]:h-10">
      {typeField}
      {titleField}
      <ItemFormFields {...fieldProps} />
      {fileField}
    </div>
  )

  const footer = (
    <FormDialogFooter
      submitText="Create Item"
      onCancel={() => handleOpenChange(false)}
      isPending={form.formState.isSubmitting}
      className="shrink-0 pt-2"
    />
  )

  // Mobile keeps both actions on one row (equal width) to preserve vertical space in the sheet.
  // The footer is scroll-reactive, mirroring the sheet header: at the top it sits at a comfortable
  // 40px tap height; once the body scrolls it shrinks to 32px + tighter padding to hand that space
  // back to the fields. Both heights override the default touch:h-11 upsize and stay above the
  // 24px WCAG 2.5.8 minimum. `scrolled` is threaded down from the sheet's scroll listener.
  const renderMobileFooter = (scrolled: boolean) => (
    <DialogFooter className={cn('shrink-0 flex-row gap-2 px-3 transition-all duration-200', scrolled ? 'py-1' : 'py-2')}>
      <Button
        type="button"
        variant="outline"
        className={cn('flex-1 transition-all duration-200', scrolled ? 'h-8 touch:h-8' : 'h-10 touch:h-10')}
        onClick={() => handleOpenChange(false)}
      >
        Cancel
      </Button>
      <SubmitButton
        className={cn('flex-1 transition-all duration-200', scrolled ? 'h-8 touch:h-8' : 'h-10 touch:h-10')}
        isPending={form.formState.isSubmitting}
      >
        Create Item
      </SubmitButton>
    </DialogFooter>
  )

  return (
    <>
      <span onClick={(e) => {
        if (!canCreateItem) {
          e.preventDefault()
          openPrompt({ title: 'Item limit reached', description: `You've used all ${FREE_TIER_ITEM_LIMIT} free items.` })
          return
        }
        handleOpenChange(true)
      }} className="contents">{triggerEl}</span>
      <ResponsiveFormDialog
        open={open}
        onOpenChange={handleOpenChange}
        title="Create New Item"
        description={descriptionNode}
        desktopClassName="flex flex-col gap-2 max-h-[90dvh] sm:max-w-[860px]"
        headerClassName="shrink-0 pb-2 border-b border-border/50"
      >
        {(isDesktop, scrolled) => (
          <form onSubmit={handleFormSubmit} className="flex flex-col flex-1 min-h-0">
            {isDesktop ? desktopBody : mobileBody}
            {isDesktop ? footer : renderMobileFooter(scrolled)}
          </form>
        )}
      </ResponsiveFormDialog>
    </>
  )
}
