'use client'

import { useRef, useState, type SyntheticEvent, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'

import { Badge } from '@/components/ui/badge'
import { Button, SubmitButton } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ItemFormFields } from '@/components/items/item-form-fields'
import { FileUpload, type UploadedFile } from '@/components/shared/file-upload'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'

import { createItemAction } from '@/actions/items'
import { apiFetch } from '@/lib/api-fetch'
import { createLogger } from '@/lib/logger'
import { ItemTypeIcon } from '@/components/shared/item-type-icon'
import { ITEM_TYPES_WITH_URL, ITEM_TYPES_WITH_FILE, PRO_ITEM_TYPE_NAMES } from '@/lib/utils/constants'
import { itemFormBaseSchema, type ItemFormBaseValues } from '@/lib/utils/validators'
import type { SidebarItemType } from '@/types/item'
import type { CollectionWithTypes } from '@/types/collection'
import type { FileItemType } from '@/lib/utils/constants'

const log = createLogger('items')

async function deleteOrphanedFile(file: UploadedFile): Promise<void> {
  const result = await apiFetch(`/api/upload?key=${encodeURIComponent(file.fileUrl)}`, { method: 'DELETE' })
  if (result.status !== 'ok') {
    log.error(`Failed to delete orphaned file: ${file.fileUrl} — ${result.message}`)
  }
}

interface CreateItemDialogProps {
  itemTypes: SidebarItemType[]
  collections: CollectionWithTypes[]
  initialType?: string
  trigger?: ReactNode
}

export function CreateItemDialog({ itemTypes, collections, initialType, trigger }: CreateItemDialogProps) {
  const router = useRouter()
  const defaultItemType = initialType || itemTypes[0]?.name || ''

  const [open, setOpen] = useState(false)
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
      collectionIds: [],
    }
  })

  const watchedLanguage = useWatch({ control: form.control, name: 'language' })
  const isSubmitting = form.formState.isSubmitting
  const showFile = ITEM_TYPES_WITH_FILE.has(itemType)
  const selectedType = itemTypes.find(t => t.name === itemType)

  function handleOpenChange(isOpen: boolean) {
    setOpen(isOpen)
    if (!isOpen) {
      if (uploadedFile && !savedRef.current) deleteOrphanedFile(uploadedFile)
      savedRef.current = false
      setItemType(defaultItemType)
      setUploadedFile(null)
      setFileError(null)
      form.reset()
    }
  }

  function handleTypeChange(val: string | null) {
    if (!val) return
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

      const tagArray = (data.tags || '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)

      const result = await createItemAction({
        title: data.title,
        description: data.description || null,
        content: data.content || null,
        url: data.url || null,
        language: data.language || null,
        tags: tagArray,
        itemTypeName: itemType,
        fileUrl: uploadedFile?.fileUrl ?? null,
        fileName: uploadedFile?.fileName ?? null,
        fileSize: uploadedFile?.fileSize ?? null,
        collectionIds: data.collectionIds,
      })

      if (result.status === 'created' || result.status === 'ok') {
        toast.success('Item created successfully')
        savedRef.current = true
        setOpen(false)
        router.refresh()
      } else {
        toast.error(result.message || 'Failed to create item')
      }
    })(e)
  }

  const triggerEl = trigger ?? (
    <Button size="sm">
      <Plus className="size-4" />
      <span className="hidden sm:inline">New Item</span>
    </Button>
  )

  return (
    <>
      <span onClick={() => setOpen(true)} className="contents">{triggerEl}</span>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-[500px]">
          <form onSubmit={handleFormSubmit}>
            <DialogHeader>
              <DialogTitle>Create New Item</DialogTitle>
              <DialogDescription>
                Add a new item to your stash.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
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
                  <SelectContent>
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

              <div className="grid gap-2">
                <Label htmlFor="title">Title <span className="text-red-500">*</span></Label>
                <Input
                  id="title"
                  placeholder="Item title"
                  {...form.register('title')}
                />
                {form.formState.errors.title && <p className="text-red-500 text-xs mt-1">{form.formState.errors.title.message}</p>}
              </div>

              <ItemFormFields
                form={form}
                itemType={itemType}
                watchedLanguage={watchedLanguage}
                collections={collections}
                variant="dialog"
              />

              {showFile && (
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
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton isPending={isSubmitting}>
                Create Item
              </SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
