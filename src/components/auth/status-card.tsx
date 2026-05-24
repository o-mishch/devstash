import Link from 'next/link'
import { CircleCheck, CircleX, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

type Variant = 'default' | 'success' | 'error'

const iconWrapperVariants: Record<Variant, string> = {
  default: 'bg-primary/10',
  success: 'bg-emerald-500/10',
  error: 'bg-destructive/10',
}

const iconVariants: Record<Variant, string> = {
  default: 'text-primary',
  success: 'text-emerald-500',
  error: 'text-destructive',
}

const defaultIcons: Partial<Record<Variant, LucideIcon>> = {
  success: CircleCheck,
  error: CircleX,
}

interface StatusCardProps {
  variant?: Variant
  icon?: LucideIcon
  title: string
  description: React.ReactNode
  action: { label: string; href: string }
  footer?: React.ReactNode
}

export function StatusCard({
  variant = 'default',
  icon,
  title,
  description,
  action,
  footer,
}: StatusCardProps) {
  const Icon = icon ?? defaultIcons[variant]

  if (!Icon) throw new Error('StatusCard: icon is required when variant is "default"')

  return (
    <div className="flex flex-col items-center gap-5 rounded-lg border border-border bg-card p-8 text-center">
      <div className={cn('flex size-14 items-center justify-center rounded-full', iconWrapperVariants[variant])}>
        <Icon className={cn('size-7', iconVariants[variant])} />
      </div>
      <div className="space-y-1.5">
        <p className="font-semibold">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Link
        href={action.href}
        className="inline-flex w-full items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        {action.label}
      </Link>
      {footer}
    </div>
  )
}
