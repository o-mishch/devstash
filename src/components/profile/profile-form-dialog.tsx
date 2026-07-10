'use client'

import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'
import { BaseProfileDialog } from './base-profile-dialog'

interface ProfileFormDialogProps {
  title: string
  description: ReactNode
  triggerText: string
  triggerIcon?: ReactNode
  children: (props: { closeDialog: () => void }) => ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  triggerVariant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link"
  triggerClassName?: string
}

export function ProfileFormDialog({
  title,
  description,
  triggerText,
  triggerIcon,
  children,
  open: controlledOpen,
  onOpenChange,
  triggerVariant,
  triggerClassName,
}: ProfileFormDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!isControlled) {
        setInternalOpen(next)
      }
      onOpenChange?.(next)
    },
    [isControlled, onOpenChange],
  )

  return (
    <BaseProfileDialog
      title={title}
      description={description}
      triggerText={triggerText}
      triggerIcon={triggerIcon}
      open={open}
      onOpenChange={handleOpenChange}
      triggerVariant={triggerVariant}
      triggerClassName={triggerClassName}
    >
      {children({ closeDialog: () => handleOpenChange(false) })}
    </BaseProfileDialog>
  )
}
