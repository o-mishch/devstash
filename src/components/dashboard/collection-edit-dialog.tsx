'use client'

import { useState, useEffect, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

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
} from '@/components/ui/dialog'
import { updateCollectionAction } from '@/actions/collections'
import { collectionFormSchema } from '@/lib/utils/validators'
import type { CollectionWithTypes } from '@/types/collection'

type FormValues = z.input<typeof collectionFormSchema>

interface CollectionEditDialogProps {
  collection: CollectionWithTypes
  trigger?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function CollectionEditDialog({ collection, trigger, open: controlledOpen, onOpenChange }: CollectionEditDialogProps) {
  const router = useRouter()
  const [internalOpen, setInternalOpen] = useState(false)
  
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen
  
  const form = useForm<FormValues>({
    resolver: zodResolver(collectionFormSchema),
    defaultValues: { name: collection.name, description: collection.description || '' },
  })

  // Reset form when collection changes or modal opens
  useEffect(() => {
    if (open) {
      form.reset({ name: collection.name, description: collection.description || '' })
    }
  }, [open, collection, form])

  const isSubmitting = form.formState.isSubmitting

  function handleOpenChange(isOpen: boolean) {
    if (onOpenChange) {
      onOpenChange(isOpen)
    } else {
      setInternalOpen(isOpen)
    }
  }

  async function onSubmit(data: FormValues) {
    const result = await updateCollectionAction(collection.id, {
      name: data.name,
      description: data.description ?? null,
    })

    if (result.status === 'ok') {
      toast.success('Collection updated')
      handleOpenChange(false)
      router.refresh()
    } else {
      toast.error(result.message ?? 'Failed to update collection')
    }
  }

  const triggerEl = trigger ? (
    <span onClick={() => handleOpenChange(true)} style={{ display: 'contents' }}>
      {trigger}
    </span>
  ) : null

  return (
    <>
      {triggerEl}
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-[440px]">
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <DialogHeader>
              <DialogTitle>Edit Collection</DialogTitle>
              <DialogDescription>
                Update the name and description of this collection.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor={`edit-name-${collection.id}`}>
                  Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id={`edit-name-${collection.id}`}
                  placeholder="e.g. React Patterns"
                  {...form.register('name')}
                />
                {form.formState.errors.name && (
                  <p className="text-xs text-red-500">{form.formState.errors.name.message}</p>
                )}
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`edit-description-${collection.id}`}>Description</Label>
                <Textarea
                  id={`edit-description-${collection.id}`}
                  placeholder="Optional description"
                  className="resize-none"
                  rows={3}
                  {...form.register('description')}
                />
                {form.formState.errors.description && (
                  <p className="text-xs text-red-500">{form.formState.errors.description.message}</p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
