import { AlertTriangle } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface BillingAlertProps {
  children: ReactNode
  textSize?: 'xs' | 'sm'
  className?: string
  variant?: 'default' | 'inline'
}

export function BillingAlert({ children, textSize = 'sm', className, variant = 'default' }: BillingAlertProps) {
  const textClass = textSize === 'xs' ? 'text-xs' : 'text-sm'

  if (variant === 'inline') {
    return (
      <div
        className={cn(
          'flex w-full items-center justify-center rounded-xl border border-amber-500/40 bg-amber-500/5 px-6 py-2.5 font-medium text-amber-700 dark:text-amber-300',
          textClass,
          className,
        )}
      >
        {children}
      </div>
    )
  }

  return (
    <div className={className ?? 'rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3'}>
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
        <p className={`${textClass} text-amber-700 dark:text-amber-300`}>{children}</p>
      </div>
    </div>
  )
}
