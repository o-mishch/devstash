'use client'

import { useRef, useState, type SyntheticEvent, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { useForm, Controller, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

import { Badge } from '@/components/ui/badge'
import { Button, SubmitButton } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CollectionSelector } from '@/components/shared/collection-selector'
import { ItemContentInput, LanguageInput } from '@/components/shared/item-content-input'
import { FileUpload } from '@/components/shared/file-upload'
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
  SelectValue,
} from '@/components/ui/select'

import { createItemAction } from '@/actions/items'
import { apiFetch } from '@/lib/api-fetch'
import { ItemTypeIcon } from '@/components/shared/item-type-icon'
import { ITEM_TYPES_WITH_CONTENT, ITEM_TYPES_WITH_LANGUAGE, ITEM_TYPES_WITH_URL, ITEM_TYPES_WITH_FILE, PRO_ITEM_TYPE_NAMES } from '@/lib/utils/constants'
import { itemFormBaseSchema } from '@/lib/utils/validators'
import type { FileItemType } from '@/lib/utils/constants'
import type { SidebarItemType } from '@/types/item'
import type { UploadedFile } from '@/components/shared/file-upload'
import type { CollectionWithTypes } from '@/types/collection'

const formSchema = itemFormBaseSchema.extend({
  itemType: z.string().min(1, 'Type is required'),
  uploadedFile: z.custom<UploadedFile>().optional(),
}).superRefine((data, ctx) => {
  if (ITEM_TYPES_WITH_URL.has(data.itemType) && !data.url) {
    ctx.addIssue({
      code: 'custom',
      message: 'URL is required for this item type',
      path: ['url'],
    })
  }
  if (ITEM_TYPES_WITH_FILE.has(data.itemType) && !data.uploadedFile) {
    ctx.addIssue({
      code: 'custom',
      message: 'File is required for this item type',
      path: ['uploadedFile'],
    })
  }
})

type FormValues = z.infer<typeof formSchema>

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
  const savedRef = useRef(false)

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      itemType: defaultItemType,
      title: '',
      description: '',
      content: '',
      url: '',
      language: '',
      tags: '',
      collectionIds: [],
    }
  })

  const itemType = useWatch({ control: form.control, name: 'itemType' }) || defaultItemType
  const watchedLanguage = useWatch({ control: form.control, name: 'language' })
  const isSubmitting = form.formState.isSubmitting

  async function deleteOrphanedFile(file: UploadedFile) {
    const result = await apiFetch(`/api/upload?key=${encodeURIComponent(file.fileUrl)}`, { method: 'DELETE' })
    if (result.status !== 'ok') {
      console.error('[deleteOrphanedFile] Failed to delete orphaned file:', file.fileUrl, result.message)
    }
  }

  function handleOpenChange(isOpen: boolean) {
    setOpen(isOpen)
    if (!isOpen) {
      const file = form.getValues('uploadedFile')
      if (file && !savedRef.current) deleteOrphanedFile(file)
      savedRef.current = false
      form.reset({
        itemType: defaultItemType,
        title: '',
        description: '',
        content: '',
        url: '',
        language: '',
        tags: '',
        collectionIds: [],
        uploadedFile: undefined
      })
    }
  }

  const handleFormSubmit = (e: SyntheticEvent) => {
    e.preventDefault()
    void form.handleSubmit(async (data: FormValues) => {
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
        itemTypeName: data.itemType,
        fileUrl: data.uploadedFile?.fileUrl ?? null,
        fileName: data.uploadedFile?.fileName ?? null,
        fileSize: data.uploadedFile?.fileSize ?? null,
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

  const showContent = ITEM_TYPES_WITH_CONTENT.has(itemType)
  const showLanguage = ITEM_TYPES_WITH_LANGUAGE.has(itemType)
  const showUrl = ITEM_TYPES_WITH_URL.has(itemType)
  const showFile = ITEM_TYPES_WITH_FILE.has(itemType)

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
              <Controller
                control={form.control}
                name="itemType"
                render={({ field }) => {
                  const selectedType = itemTypes.find(t => t.name === field.value)
                  return (
                    <Select value={field.value} onValueChange={(val) => { field.onChange(val); form.clearErrors() }}>
                      <SelectTrigger id="type" className="w-full">
                        {field.value ? (
                          <div className="flex items-center gap-2">
                            <ItemTypeIcon
                              iconName={selectedType?.icon || ''}
                              color={selectedType?.color || ''}
                              className="size-4"
                            />
                            <span className="capitalize">{field.value}</span>
                            {PRO_ITEM_TYPE_NAMES.has(field.value) && (
                              <Badge variant="outline" className="h-4 px-1 text-[10px] font-semibold text-muted-foreground/60">PRO</Badge>
                            )}
                          </div>
                        ) : (
                          <SelectValue placeholder="Select type" />
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
                  )
                }}
              />
              {form.formState.errors.itemType && <p className="text-red-500 text-xs mt-1">{form.formState.errors.itemType.message}</p>}
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

            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                placeholder="Optional description"
                {...form.register('description')}
              />
              {form.formState.errors.description && <p className="text-red-500 text-xs mt-1">{form.formState.errors.description.message}</p>}
            </div>

            {showUrl && (
              <div className="grid gap-2">
                <Label htmlFor="url">URL <span className="text-red-500">*</span></Label>
                <Input
                  id="url"
                  type="url"
                  placeholder="https://example.com"
                  {...form.register('url')}
                />
                {form.formState.errors.url && <p className="text-red-500 text-xs mt-1">{form.formState.errors.url.message}</p>}
              </div>
            )}

            {showLanguage && (
              <div className="grid gap-2">
                <Label htmlFor="language">Language</Label>
                <Controller
                  control={form.control}
                  name="language"
                  render={({ field }) => (
                    <LanguageInput
                      id="language"
                      value={field.value || ''}
                      onChange={field.onChange}
                      placeholder="e.g. typescript, bash"
                    />
                  )}
                />
                {form.formState.errors.language && <p className="text-red-500 text-xs mt-1">{form.formState.errors.language.message}</p>}
              </div>
            )}

            {showContent && (
              <div className="grid gap-2">
                <Label htmlFor="content">Content</Label>
                <Controller
                  control={form.control}
                  name="content"
                  render={({ field }) => (
                    <ItemContentInput
                      id="content"
                      itemType={itemType}
                      value={field.value || ''}
                      onChange={field.onChange}
                      language={watchedLanguage}
                      placeholder="Paste your content here..."
                      contentEditorClassName="h-64"
                      textareaClassName="min-h-[100px] font-mono text-sm"
                    />
                  )}
                />
                {form.formState.errors.content && <p className="text-red-500 text-xs mt-1">{form.formState.errors.content.message}</p>}
              </div>
            )}

            {showFile && (
              <div className="grid gap-2">
                <Label>File <span className="text-red-500">*</span></Label>
                <Controller
                  control={form.control}
                  name="uploadedFile"
                  render={({ field }) => (
                    <FileUpload
                      itemType={itemType as FileItemType}
                      value={field.value || null}
                      onUpload={(file) => {
                        if (field.value) deleteOrphanedFile(field.value)
                        field.onChange(file)
                      }}
                      onClear={() => {
                        if (field.value) deleteOrphanedFile(field.value)
                        field.onChange(null)
                      }}
                    />
                  )}
                />
                {form.formState.errors.uploadedFile && <p className="text-red-500 text-xs mt-1">{form.formState.errors.uploadedFile.message as string}</p>}
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="tags">Tags</Label>
              <Input
                id="tags"
                placeholder="react, hooks, frontend (comma separated)"
                {...form.register('tags')}
              />
              {form.formState.errors.tags && <p className="text-red-500 text-xs mt-1">{form.formState.errors.tags.message}</p>}
            </div>

            {collections.length > 0 && (
              <div className="grid gap-2">
                <Label>Collections</Label>
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
                {form.formState.errors.collectionIds && <p className="text-red-500 text-xs mt-1">{form.formState.errors.collectionIds.message}</p>}
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
