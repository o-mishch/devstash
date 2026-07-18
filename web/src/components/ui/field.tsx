import type { ComponentProps, ReactNode } from 'react'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import { Label } from '@/components/ui/label'

const fieldVariants = cva('group/field flex w-full gap-2 data-[invalid=true]:text-destructive', {
  variants: {
    orientation: {
      vertical: 'flex-col *:w-full',
      horizontal: 'flex-row items-center *:data-[slot=field-label]:flex-auto',
    },
  },
  defaultVariants: {
    orientation: 'vertical',
  },
})

function Field({
  className,
  orientation = 'vertical',
  ...props
}: ComponentProps<'div'> & VariantProps<typeof fieldVariants>): ReactNode {
  return (
    <div
      data-slot="field"
      data-orientation={orientation}
      className={cn(fieldVariants({ orientation }), className)}
      {...props}
    />
  )
}

function FieldLabel({ className, ...props }: ComponentProps<typeof Label>): ReactNode {
  return (
    <Label
      data-slot="field-label"
      className={cn(
        'flex w-fit gap-2 leading-snug group-data-[disabled=true]/field:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

function FieldDescription({ className, ...props }: ComponentProps<'p'>): ReactNode {
  return (
    <p
      data-slot="field-description"
      className={cn('text-sm leading-normal font-normal text-muted-foreground', className)}
      {...props}
    />
  )
}

function FieldError({ className, ...props }: ComponentProps<'div'>): ReactNode {
  return (
    <div
      role="alert"
      data-slot="field-error"
      className={cn('text-sm font-normal text-destructive', className)}
      {...props}
    />
  )
}

export { Field, FieldLabel, FieldDescription, FieldError }
