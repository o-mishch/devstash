import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn, hasText } from '@/lib/utils'

interface PageHeaderProps {
  icon?: LucideIcon
  iconClassName?: string
  title: string
  count?: number
  description?: string
  actions?: ReactNode
}

export function PageHeader({
  icon: Icon,
  iconClassName,
  title,
  count,
  description,
  actions,
}: PageHeaderProps): ReactNode {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border pb-5">
      <div className="flex items-start gap-3">
        {Icon && (
          <div className="mt-0.5 rounded-lg border border-border bg-card p-2">
            <Icon className={cn('size-5 text-muted-foreground', iconClassName)} />
          </div>
        )}
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
            {typeof count === 'number' && (
              <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
                {count}
              </span>
            )}
          </div>
          {hasText(description) && (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      </div>
      {actions}
    </div>
  )
}
