'use client'

import { useRef, useState, startTransition, useMemo, useEffect, type SyntheticEvent, type ReactNode } from 'react'
import { Plus, FolderPlus } from 'lucide-react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button, SubmitButton } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ItemFormFields } from '@/components/items/item-form-fields'
import { ResizableSplit } from '@/components/items/resizable-split'
import { FileUpload, type UploadedFile } from '@/components/shared/file-upload'
import { UnsavedChangesDialog } from '@/components/shared/unsaved-changes-dialog'
import { DialogFooter } from '@/components/ui/dialog'
import { FormDialogFooter } from '@/components/shared/form-dialog-footer'
import { ResponsiveFormDialog, morphOriginFromClick, type MorphOrigin } from '@/components/ui/responsive-form-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
} from '@/components/ui/select'
import { CollectionFormFields } from '@/components/shared/collection-form-fields'

import { useCreateItem } from '@/hooks/use-create-item'
import { api } from '@/lib/api/client'
import { ItemTypeIcon } from '@/components/shared/item-type-icon'
import { ITEM_TYPES_WITH_URL, ITEM_TYPES_WITH_FILE, ITEM_TYPES_WITH_CONTENT, PRO_ITEM_TYPE_NAMES, FREE_TIER_COLLECTION_LIMIT, type FileItemType } from '@/lib/utils/constants'
import { useUpgradePromptStore } from '@/stores/upgrade-prompt'
import { useAppUserFlagsStore } from '@/stores/app-user-flags'

import { itemFormBaseSchema, collectionFormSchema, type ItemFormBaseValues } from '@/lib/utils/validators'
import { parseTagString } from '@/lib/utils/format'
import { cn } from '@/lib/utils'
import { useDirtyGuard } from '@/hooks/use-dirty-guard'
import { useSelectTouchSwipe } from '@/hooks/use-select-touch-swipe'
import type { SidebarItemType } from '@/types/item'
import type { CollectionPickerItem } from '@/types/collection'

const COLLECTION_TYPE_VALUE = '__collection__'

type CollectionFormValues = z.input<typeof collectionFormSchema>

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
  const router = useRouter()
  const { isPro, canCreateItem, canCreateCollection } = useAppUserFlagsStore()
  const { openPrompt } = useUpgradePromptStore()
  const validInitialType = (initialType && PRO_ITEM_TYPE_NAMES.has(initialType) && !isPro) ? itemTypes[0]?.name : initialType
  // Captured once at mount so mid-session flag changes (canCreateItem/canCreateCollection)
  // don't shift defaultItemType and spuriously trigger the dirty guard.
  const defaultItemType = useMemo(
    () => (!canCreateItem && canCreateCollection) ? COLLECTION_TYPE_VALUE : (validInitialType || itemTypes[0]?.name || ''),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const [itemType, setItemType] = useState(defaultItemType)
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [morphOrigin, setMorphOrigin] = useState<MorphOrigin | null>(null)
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

  const collectionForm = useForm<CollectionFormValues>({
    resolver: zodResolver(collectionFormSchema),
    defaultValues: { name: '', description: '' },
  })

  const watchedLanguage = useWatch({ control: form.control, name: 'language' })
  const showFile = ITEM_TYPES_WITH_FILE.has(itemType)
  const showContentEditor = ITEM_TYPES_WITH_CONTENT.has(itemType)
  const selectedType = itemTypes.find(t => t.name === itemType)

  const effectiveDefaultType = validInitialType || defaultItemType

  // Switching the item type alone is not a "change" — it only re-shapes which empty fields are
  // shown, so it must not trigger the unsaved-changes guard. Only actual field edits count.
  const isDirty =
    form.formState.isDirty ||
    uploadedFile !== null ||
    collectionForm.formState.isDirty

  // In controlled mode (mobile), the parent changes `open` prop directly without
  // calling handleOpenChange(true), so the onOpenChange callback below never fires
  // on open. Sync itemType whenever the dialog transitions to open.
  // deps intentionally omitted — validInitialType/defaultItemType are captured at mount;
  // mid-session prop changes to initialType do not shift the default once the dialog is open.
  useEffect(() => {
    if (controlledOpen) {
      startTransition(() => setItemType(effectiveDefaultType))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlledOpen])

  const { open, handleOpenChange, confirmOpen, handleConfirmOpenChange, handleDiscard } = useDirtyGuard({
    open: controlledOpen,
    onOpenChange: (isOpen) => {
      controlledOnOpenChange?.(isOpen)
      if (isOpen) {
        setItemType(effectiveDefaultType)
      }
    },
    onClose: () => {
      if (uploadedFile && !savedRef.current) deleteOrphanedFile(uploadedFile)
      savedRef.current = false
      setUploadedFile(null)
      setFileError(null)
      form.reset({ title: '', description: '', content: '', url: '', language: '', tags: '', collectionIds: initialCollectionId ? [initialCollectionId] : [] })
      collectionForm.reset({ name: '', description: '' })
    },
    isDirty,
  })

  function handleTypeChange(val: string | null) {
    if (!val) return
    if (val === COLLECTION_TYPE_VALUE && !canCreateCollection) {
      openPrompt({ title: 'Collection limit reached', description: `You've used all ${FREE_TIER_COLLECTION_LIMIT} free collections.` })
      return
    }
    if (PRO_ITEM_TYPE_NAMES.has(val) && !isPro) {
      openPrompt({ title: 'Pro feature', description: 'File and image uploads are only available on the Pro plan.', onUpgrade: () => handleOpenChange(false) })
      return
    }
    setFileError(null)
    form.clearErrors()
    collectionForm.clearErrors()
    // startTransition: if the target editor chunk isn't cached yet, React keeps the
    // current editor mounted until the new one is ready — no flash. If the chunk is
    // already in memory (preloaded on dialog open), the transition commits in the
    // same frame so the switch is still instant.
    startTransition(() => {
      setItemType(val)
    })
  }

  const handleCollectionSubmit = (e: SyntheticEvent) => {
    e.preventDefault()
    void collectionForm.handleSubmit(async (data: CollectionFormValues) => {
      const { error, response } = await api.POST('/collections', {
        body: { name: data.name, description: data.description ?? null },
      })
      if (!error) {
        toast.success('Collection created')
        handleOpenChange(false, true)
        router.refresh()
        return
      }
      if (response.status === 403) {
        toast.warning(error.message || 'Upgrade to Pro to continue.')
      } else {
        toast.error(error.message || 'Failed to create collection')
      }
    })(e)
  }

  const handleFormSubmit = (e: SyntheticEvent) => {
    e.preventDefault()
    void form.handleSubmit(async (data: ItemFormBaseValues) => {
      if (ITEM_TYPES_WITH_URL.has(itemType)) {
        if (!data.url) {
          form.setError('url', { message: 'URL is required for this item type' })
          return
        }
        const urlParsed = z.string().url().safeParse(data.url)
        if (!urlParsed.success) {
          form.setError('url', { message: 'Must be a valid URL' })
          return
        }
      }
      if (ITEM_TYPES_WITH_FILE.has(itemType) && !uploadedFile) {
        setFileError('File is required for this item type')
        return
      }

      const tagArray = parseTagString(data.tags)
      const capturedFile = uploadedFile

      savedRef.current = true
      handleOpenChange(false, true)

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

  const isCollectionMode = itemType === COLLECTION_TYPE_VALUE

  const descriptionNode = isCollectionMode
    ? 'Organize your items into a new collection.'
    : (
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
          {isCollectionMode ? (
            <div className="flex items-center gap-2">
              <FolderPlus className="size-4 text-primary" />
              <span>Collection</span>
            </div>
          ) : itemType ? (
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
          <SelectItem value={COLLECTION_TYPE_VALUE} disabled={!canCreateCollection}>
            <div className="flex items-center gap-2">
              <FolderPlus className="size-4 text-primary" />
              <span>Collection</span>
            </div>
          </SelectItem>
          <SelectSeparator />
          {itemTypes.map((type) => (
            <SelectItem key={type.id} value={type.name} disabled={!canCreateItem}>
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
    <div className="flex-1 min-h-0 overflow-y-auto grid gap-3 py-3 px-1 scrollbar-thin [&_[data-slot=input]]:h-10 [&_[data-slot=select-trigger]]:h-10">
      {typeField}
      {titleField}
      <ItemFormFields {...fieldProps} />
      {fileField}
    </div>
  )

  const submitText = isCollectionMode ? 'Create Collection' : 'Create Item'
  const isPending = isCollectionMode ? collectionForm.formState.isSubmitting : form.formState.isSubmitting

  const footer = (
    <FormDialogFooter
      submitText={submitText}
      onCancel={() => handleOpenChange(false)}
      isPending={isPending}
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
        isPending={isPending}
      >
        {submitText}
      </SubmitButton>
    </DialogFooter>
  )

  const collectionDesktopBody = (
    <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden grid gap-6 py-5 px-1 scrollbar-thin">
      {typeField}
      <CollectionFormFields form={collectionForm} idPrefix="unified-create" />
    </div>
  )

  const collectionMobileBody = (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto gap-3 py-3 px-1 scrollbar-thin [&_[data-slot=input]]:h-10 [&_[data-slot=select-trigger]]:h-10">
      {typeField}
      <CollectionFormFields form={collectionForm} idPrefix="unified-create-mobile" growDescription />
    </div>
  )

  return (
    <>
      <span onClick={(e) => {
        if (!canCreateItem && !canCreateCollection) {
          e.preventDefault()
          openPrompt({ title: 'Limits reached', description: `You've used all free items and collections. Please upgrade to Pro.` })
          return
        }
        setMorphOrigin(morphOriginFromClick(e))
        handleOpenChange(true)
      }} className="contents">{triggerEl}</span>
      <ResponsiveFormDialog
        open={open}
        onOpenChange={handleOpenChange}
        morphOrigin={morphOrigin}
        title={isCollectionMode ? 'Create Collection' : 'Create New Item'}
        description={descriptionNode}
        desktopClassName="flex flex-col gap-2 max-h-[90dvh] sm:max-w-[860px]"
        headerClassName="shrink-0 pb-2 border-b border-border/50"
        mobileClassName="data-[side=bottom]:h-[calc(100dvh-3.5rem)]"
      >
        {(isDesktop, scrolled) => (
          <form
            onSubmit={isCollectionMode ? handleCollectionSubmit : handleFormSubmit}
            className="flex flex-col flex-1 min-h-0"
          >
            {isCollectionMode
              ? (isDesktop ? collectionDesktopBody : collectionMobileBody)
              : (isDesktop ? desktopBody : mobileBody)
            }
            {isDesktop ? footer : renderMobileFooter(scrolled)}
          </form>
        )}
      </ResponsiveFormDialog>
      <UnsavedChangesDialog
        open={confirmOpen}
        onOpenChange={handleConfirmOpenChange}
        onDiscard={handleDiscard}
      />
    </>
  )
}
