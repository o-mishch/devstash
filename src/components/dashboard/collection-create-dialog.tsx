'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { FolderPlus } from 'lucide-react'
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
import { createCollectionAction } from '@/actions/collections'
import { collectionFormSchema } from '@/lib/utils/validators'

type FormValues = z.input<typeof collectionFormSchema>

interface CollectionCreateDialogProps {
  trigger?: ReactNode
}

export function CollectionCreateDialog({ trigger }: CollectionCreateDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  const form = useForm<FormValues>({
    resolver: zodResolver(collectionFormSchema),
    defaultValues: { name: '', description: '' },
  })

  const isSubmitting = form.formState.isSubmitting

  function handleOpenChange(isOpen: boolean) {
    setOpen(isOpen)
    if (!isOpen) form.reset()
  }

  async function onSubmit(data: FormValues) {
    const result = await createCollectionAction({
      name: data.name,
      description: data.description ?? null,
    })

    if (result.status === 'created' || result.status === 'ok') {
      toast.success('Collection created')
      setOpen(false)
      router.refresh()
    } else {
      toast.error(result.message ?? 'Failed to create collection')
    }
  }

  const triggerEl = trigger ?? (
    <Button variant="outline" size="sm" className="hidden sm:flex">
      <FolderPlus className="size-4" />
      New Collection
    </Button>
  )

  return (
    <>
      <span onClick={() => setOpen(true)} style={{ display: 'contents' }}>{triggerEl}</span>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-[440px]">
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <DialogHeader>
              <DialogTitle>Create Collection</DialogTitle>
              <DialogDescription>
                Organize your items into a new collection.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <CollectionFormFields register={form.register} errors={form.formState.errors} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton isPending={isSubmitting}>
                Create Collection
              </SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
