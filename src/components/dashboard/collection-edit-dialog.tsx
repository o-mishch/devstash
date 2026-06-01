'use client'

import { useState, useEffect, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

import { Button, SubmitButton } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { CollectionFormFields } from '@/components/shared/collection-form-fields'
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
              <CollectionFormFields
                register={form.register}
                errors={form.formState.errors}
                idPrefix={`edit-${collection.id}`}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <SubmitButton isPending={isSubmitting}>
                Save Changes
              </SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
