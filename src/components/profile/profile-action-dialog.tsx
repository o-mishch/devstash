'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { DestructiveDialogFooter } from '@/components/shared/destructive-dialog-footer'
import type { ReactNode } from 'react'
import { safe } from '@orpc/client'
import { orpcClient } from '@/lib/api/client'
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
}: ProfileActionDialogProps) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleAction() {
    startTransition(async () => {
      const { error } = await safe(orpcClient.profile.unlinkAccount({ id: accountId }))
      if (!error) {
        toast.success(successMessage)
        setOpen(false)
      } else {
        toast.error(error.message || errorMessage || 'Action failed.')
      }
    })
  }

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
        onConfirm={handleAction}
        isPending={isPending}
        confirmText={confirmText}
      />
    </BaseProfileDialog>
  )
}
