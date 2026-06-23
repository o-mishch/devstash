'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { DestructiveDialogFooter } from '@/components/shared/destructive-dialog-footer'
import type { ReactNode } from 'react'
import { api } from '@/lib/api/client'
import { BaseProfileDialog } from './base-profile-dialog'

interface ProfileActionDialogProps {
  title: string
  description: ReactNode
  triggerText: string
  triggerIcon?: ReactNode
  confirmText: string
  /** Linked account to unlink on confirm. */
  accountId: string
  successMessage: string
  errorMessage?: string
  triggerClassName?: string
  onSuccess?: () => void
}

export function ProfileActionDialog({
  title,
  description,
  triggerText,
  triggerIcon,
  confirmText,
  accountId,
  successMessage,
  errorMessage,
  triggerClassName = "h-7 px-2 text-xs text-muted-foreground hover:text-destructive",
  onSuccess,
}: ProfileActionDialogProps) {
  const [open, setOpen] = useState(false)

  const actionMutation = useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE('/profile/accounts/{id}', { params: { path: { id: accountId } } })
      if (error) throw new Error(error.message || errorMessage || 'Action failed.')
    },
    onSuccess: () => {
      toast.success(successMessage)
      setOpen(false)
      onSuccess?.()
    },
    onError: (error: Error) => toast.error(error.message || errorMessage || 'Action failed.'),
  })

  return (
    <BaseProfileDialog
      title={title}
      description={description}
      triggerText={triggerText}
      triggerIcon={triggerIcon}
      open={open}
      onOpenChange={setOpen}
      triggerClassName={triggerClassName}
    >
      <DestructiveDialogFooter
        onCancel={() => setOpen(false)}
        onConfirm={() => actionMutation.mutate()}
        isPending={actionMutation.isPending}
        confirmText={confirmText}
      />
    </BaseProfileDialog>
  )
}
