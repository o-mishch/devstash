'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { DestructiveDialogFooter } from '@/components/shared/destructive-dialog-footer'
import type { ReactNode } from 'react'
import { BaseProfileDialog } from './base-profile-dialog'

interface ProfileActionDialogProps {
  title: string
  description: ReactNode
  triggerText: string
  triggerIcon?: ReactNode
  confirmText: string
  action: () => Promise<{ status: string; message?: string | null }>
  successMessage: string
  errorMessage?: string
}

export function ProfileActionDialog({
  title,
  description,
  triggerText,
  triggerIcon,
  confirmText,
  action,
  successMessage,
  errorMessage,
}: ProfileActionDialogProps) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleAction() {
    startTransition(async () => {
      const result = await action()
      if (result.status === 'ok') {
        toast.success(successMessage)
        setOpen(false)
      } else {
        toast.error(result.message ?? errorMessage ?? 'Action failed.')
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
      triggerClassName="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
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
