'use client'

import { type ReactNode, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

import { ResponsiveFormDialog } from '@/components/ui/responsive-form-dialog'
import { CollectionFormFields } from '@/components/shared/collection-form-fields'
import { FormDialogFooter } from '@/components/shared/form-dialog-footer'
import { collectionFormSchema } from '@/lib/utils/validators'
import { useControllableOpen } from '@/hooks/use-controllable-open'
import { FREE_TIER_COLLECTION_LIMIT } from '@/lib/utils/constants'
import { useUpgradePromptStore } from '@/stores/upgrade-prompt'

type FormValues = z.input<typeof collectionFormSchema>

// What `onSubmitAction` resolves to — the openapi-fetch result shape (it does not throw): `error` is
// the parsed `{ message }` body on failure; `response.status` drives the Pro-gate (403) branch.
interface CollectionSubmitResult {
  error?: { message?: string }
  response: Response
}

interface CollectionFormDefaultValues {
  name: string
  description: string
}

interface CollectionFormDialogProps {
  title: string
  description: string
  submitText: string
  successMessage: string
  defaultValues: CollectionFormDefaultValues
  // Returns the openapi-fetch result — `{ error, response }`, never throws.
  onSubmitAction: (data: FormValues) => Promise<CollectionSubmitResult>
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
  const { openPrompt } = useUpgradePromptStore()

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
    const { error, response } = await onSubmitAction(data)

    if (!error) {
      toast.success(successMessage)
      handleOpenChange(false)
      router.refresh()
      return
    }

    if (response.status === 403) {
      toast.warning(error.message || 'Upgrade to Pro to continue.')
    } else {
      toast.error(error.message || 'Failed to save collection')
    }
  }

  const triggerEl = trigger ? (
    <span onClick={(e) => {
      if (!canCreate) {
        e.preventDefault()
        openPrompt({ title: 'Collection limit reached', description: `You've used all ${FREE_TIER_COLLECTION_LIMIT} free collections.` })
        return
      }
      handleOpenChange(true)
    }} className="contents">
      {trigger}
    </span>
  ) : null

  const fields = <CollectionFormFields form={form} idPrefix={idPrefix} />
  // Mobile reuses the same fields but lets the Description grow to fill the (resizable) sheet.
  const mobileFields = <CollectionFormFields form={form} idPrefix={idPrefix} growDescription />

  return (
    <>
      {triggerEl}
      <ResponsiveFormDialog
        open={open}
        onOpenChange={handleOpenChange}
        title={title}
        description={description}
        desktopClassName="sm:max-w-[440px]"
        mobileResizable
      >
        {(isDesktop) =>
          isDesktop ? (
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <div className="grid gap-4 py-4">{fields}</div>
              <FormDialogFooter
                submitText={submitText}
                onCancel={() => handleOpenChange(false)}
                isPending={form.formState.isSubmitting}
              />
            </form>
          ) : (
            // flex-1 so the form fills the resizable sheet; the Description field inside flex-grows,
            // so dragging the handle up enlarges it. Name + footer stay fixed (shrink-0).
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col gap-4 pt-4">
              {mobileFields}
              <FormDialogFooter
                mobile
                submitText={submitText}
                onCancel={() => handleOpenChange(false)}
                isPending={form.formState.isSubmitting}
                className="shrink-0 pt-2"
              />
            </form>
          )
        }
      </ResponsiveFormDialog>
    </>
  )
}
