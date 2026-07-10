'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useCallback, type ComponentProps, type ReactNode } from 'react'

export interface BaseProfileDialogProps {
  title: string
  description: ReactNode
  triggerText: string
  triggerIcon?: ReactNode
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
  triggerVariant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link"
  triggerClassName?: string
}

export function BaseProfileDialog({
  title,
  description,
  triggerText,
  triggerIcon,
  open,
  onOpenChange,
  children,
  triggerVariant = "ghost",
  triggerClassName = "h-7 px-2 text-xs",
}: BaseProfileDialogProps) {
  const renderTrigger = useCallback(
    (triggerProps: ComponentProps<typeof Button>) => (
      <Button
        {...triggerProps}
        variant={triggerVariant}
        size="sm"
        className={triggerClassName}
      >
        {triggerIcon}
        {triggerText}
      </Button>
    ),
    [triggerVariant, triggerClassName, triggerIcon, triggerText],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={renderTrigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}
