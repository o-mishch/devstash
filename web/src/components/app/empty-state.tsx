import type { LucideIcon } from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'
import { hasText } from '@/lib/utils'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  action?: ReactNode
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: EmptyStateProps): ReactElement {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/70 px-6 py-16 text-center">
      <Icon className="size-8 text-muted-foreground/40" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      {hasText(description) && (
        <p className="max-w-xs text-sm text-muted-foreground">{description}</p>
      )}
      {action}
    </div>
  )
}
