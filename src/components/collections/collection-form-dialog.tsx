'use client'

import { type ReactNode, useEffect, useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useMutation } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

import { ResponsiveFormDialog, morphOriginFromClick, type MorphOrigin } from '@/components/ui/responsive-form-dialog'
import { CollectionFormFields } from '@/components/shared/collection-form-fields'
import { FormDialogFooter } from '@/components/shared/form-dialog-footer'
import { UnsavedChangesDialog } from '@/components/shared/unsaved-changes-dialog'
import { collectionFormSchema } from '@/lib/utils/validators'
import { useDirtyGuard } from '@/hooks/use-dirty-guard'
import { FREE_TIER_COLLECTION_LIMIT } from '@/lib/utils/constants'
import { useUpgradePromptStore } from '@/stores/upgrade-prompt'
import { useApplyCollectionSave } from '@/hooks/use-collections'
import type { CollectionWithTypes } from '@/types/collection'

type FormValues = z.input<typeof collectionFormSchema>

// What `onSubmitAction` resolves to — the openapi-fetch result shape (it does not throw): `data` is the
// saved collection on success; `error` is the parsed `{ message }` body on failure; `response.status`
// drives the Pro-gate (403) branch.
interface CollectionSubmitResult {
  data?: CollectionWithTypes | null
  error?: { message: string } | null
  response?: { status: number } | null
}

interface CollectionFormDialogProps {
  title: string
  description: string
  submitText: string
  successMessage: string
  defaultValues?: Partial<FormValues>
  onSubmitAction: (values: FormValues) => Promise<CollectionSubmitResult>
  // Optional: controlled (parent-driven `open`) usages render no trigger of their own.
  trigger?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  idPrefix?: string
  canCreate?: boolean
  // True for the create dialog (not edit): a new collection can push a free-tier user over the limit,
  // flipping canCreateCollection in /profile/me. Edit never changes the count, so it skips this.
  isCreate?: boolean
  // Fired with the saved collection on success (used to auto-select a freshly created collection).
  onCreated?: (collection: CollectionWithTypes) => void
  // Desktop morph origin for a controlled (no-trigger) open — lets the dialog grow out of the element
  // that opened it (e.g. the combobox "Create" row). Ignored when a built-in trigger captures its own.
  morphOrigin?: MorphOrigin | null
  // Lift the dialog above another open drawer/dialog (z-50) and dim it — set when this is opened from
  // inside the item drawer / item-create dialog's collection picker.
  elevated?: boolean
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
  isCreate = false,
  onCreated,
  morphOrigin: controlledMorphOrigin,
  elevated = false,
}: CollectionFormDialogProps) {
  const applyCollectionSave = useApplyCollectionSave()
  const { openPrompt } = useUpgradePromptStore()
  // Set when the built-in trigger is clicked; for a controlled open the caller supplies the origin instead.
  const [triggerMorphOrigin, setTriggerMorphOrigin] = useState<MorphOrigin | null>(null)

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

  const { open, handleOpenChange, confirmOpen, handleConfirmOpenChange, handleDiscard } = useDirtyGuard({
    open: controlledOpen,
    onOpenChange: controlledOnOpenChange,
    onClose,
    isDirty: form.formState.isDirty,
  })

  useEffect(() => {
    if (open) {
      form.reset(defaultValuesRef.current)
    }
  }, [open, form])

  // The submit routes through useMutation for a single pending source. `onSubmitAction` (openapi-fetch)
  // never throws — it resolves `{ error, response }` — so the success/403/error branching stays in
  // onSuccess on the result rather than onError.
  const submitMutation = useMutation({
    mutationFn: (data: FormValues) => onSubmitAction(data),
    onSuccess: ({ data, error, response }) => {
      if (!error) {
        toast.success(successMessage)
        handleOpenChange(false, true)
        applyCollectionSave(data, { isCreate })
        if (data) onCreated?.(data)
        return
      }
      if (response?.status === 403) {
        toast.warning(error.message || 'Upgrade to Pro to continue.')
      } else {
        toast.error(error.message || 'Failed to save collection')
      }
    },
  })

  async function onSubmit(data: FormValues) {
    await submitMutation.mutateAsync(data)
  }

  const triggerEl = trigger ? (
    <span onClick={(e) => {
      if (!canCreate) {
        e.preventDefault()
        openPrompt({ title: 'Collection limit reached', description: `You've used all ${FREE_TIER_COLLECTION_LIMIT} free collections.` })
        return
      }
      setTriggerMorphOrigin(morphOriginFromClick(e))
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
        morphOrigin={controlledMorphOrigin ?? triggerMorphOrigin}
        elevated={elevated}
        mobileResizable
      >
        {(isDesktop) =>
          isDesktop ? (
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <div className="grid gap-4 py-4">{fields}</div>
              <FormDialogFooter
                submitText={submitText}
                onCancel={() => handleOpenChange(false)}
                isPending={submitMutation.isPending}
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
                isPending={submitMutation.isPending}
                className="shrink-0 pt-2"
              />
            </form>
          )
        }
      </ResponsiveFormDialog>
      <UnsavedChangesDialog
        open={confirmOpen}
        onOpenChange={handleConfirmOpenChange}
        onDiscard={handleDiscard}
      />
    </>
  )
}
