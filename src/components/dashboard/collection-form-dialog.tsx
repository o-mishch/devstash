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
import { FREE_TIER_COLLECTION_LIMIT } from '@/lib/usage'
import { useUpgradePrompt } from '@/context/upgrade-prompt-context'
import type { ApiBody } from '@/types/api'

type FormValues = z.input<typeof collectionFormSchema>

interface CollectionFormDialogProps {
  title: string
  description: string
  submitText: string
  successMessage: string
  defaultValues: { name: string; description: string }
  onSubmitAction: (data: FormValues) => Promise<ApiBody<unknown>>
  trigger?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  idPrefix?: string
  canCreate?: boolean
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
  canCreate = true,
}: CollectionFormDialogProps) {
  const router = useRouter()
  const { showUpgradePrompt } = useUpgradePrompt()

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
      if (result.status === 'forbidden') {
        toast.warning(result.message ?? 'Upgrade to Pro to continue.')
      } else {
        toast.error(result.message ?? 'Failed to save collection')
      }
    }
  }

  const triggerEl = trigger ? (
    <span onClick={(e) => {
      if (!canCreate) {
        e.preventDefault()
        showUpgradePrompt({ title: 'Collection limit reached', description: `You've used all ${FREE_TIER_COLLECTION_LIMIT} free collections.` })
        return
      }
      handleOpenChange(true)
    }} className="contents">
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
