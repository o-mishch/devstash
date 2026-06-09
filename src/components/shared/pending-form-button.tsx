'use client'

import type { ReactNode } from 'react'
import { useFormStatus } from 'react-dom'
import { type VariantProps } from 'class-variance-authority'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface PendingFormButtonProps extends VariantProps<typeof buttonVariants> {
  label: string
  pendingLabel?: string
  className?: string
  trailingIcon?: ReactNode
}

export function PendingFormButton({
  label,
  pendingLabel = 'Redirecting...',
  variant = 'default',
  className,
  trailingIcon,
}: PendingFormButtonProps) {
  const { pending } = useFormStatus()

  return (
    <Button type="submit" variant={variant} disabled={pending} className={cn(className)}>
      {pending ? pendingLabel : label}
      {!pending && trailingIcon}
    </Button>
  )
}
