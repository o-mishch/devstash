'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { ReactNode } from 'react'

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
  triggerVariant = "ghost",
  triggerClassName = "h-7 px-2 text-xs",
}: ProfileFormDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen

  function handleOpenChange(next: boolean) {
    if (!isControlled) {
      setInternalOpen(next)
    }
    onOpenChange?.(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button variant={triggerVariant} size="sm" className={triggerClassName}>
            {triggerIcon}
            {triggerText}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {description}
          </DialogDescription>
        </DialogHeader>
        {children({ closeDialog: () => handleOpenChange(false) })}
      </DialogContent>
    </Dialog>
  )
}
