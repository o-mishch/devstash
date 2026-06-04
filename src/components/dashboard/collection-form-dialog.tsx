'use client'

import { type ReactNode, useEffect, useCallback, useRef } from 'react'
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
import { collectionFormSchema } from '@/lib/utils/validators'
import { useControllableOpen } from '@/hooks/use-controllable-open'

type FormValues = z.input<typeof collectionFormSchema>

interface CollectionFormDialogProps {
  title: string
  description: string
  submitText: string
  successMessage: string
  defaultValues: { name: string; description: string }
  onSubmitAction: (data: FormValues) => Promise<{ status: string; message?: string | null }>
  trigger?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  idPrefix?: string
}

export function CollectionFormDialog({
  title,
  description,
  submitText,
  successMessage,
  defaultValues,
  onSubmitAction,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  idPrefix,
}: CollectionFormDialogProps) {
  const router = useRouter()

  const form = useForm<FormValues>({
    resolver: zodResolver(collectionFormSchema),
    defaultValues,
  })

  const defaultValuesRef = useRef(defaultValues)
  useEffect(() => {
    defaultValuesRef.current = defaultValues
  }, [defaultValues])

  const onClose = useCallback(() => {
    form.reset(defaultValuesRef.current)
  }, [form])

  const { open, handleOpenChange } = useControllableOpen({
    open: controlledOpen,
    onOpenChange: controlledOnOpenChange,
    onClose,
  })

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      form.reset(defaultValuesRef.current)
    }
  }, [open, form])

  async function onSubmit(data: FormValues) {
    const result = await onSubmitAction(data)

    if (result.status === 'created' || result.status === 'ok') {
      toast.success(successMessage)
      handleOpenChange(false)
      router.refresh()
    } else {
      toast.error(result.message ?? 'Failed to save collection')
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
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <CollectionFormFields
                register={form.register}
                errors={form.formState.errors}
                idPrefix={idPrefix}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <SubmitButton isPending={form.formState.isSubmitting}>
                {submitText}
              </SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
