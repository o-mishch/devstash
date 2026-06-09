'use client'

import type { ReactNode } from 'react'
import { Sparkles, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAppUser } from '@/context/app-user-context'
import { cn } from '@/lib/utils'

interface AiFieldFrameProps {
  children: ReactNode
  className?: string
}

export function AiFieldFrame({ children, className }: AiFieldFrameProps) {
  const { isPro } = useAppUser()

  return (
    <div
      className={cn(
        'relative rounded-md transition-colors',
        isPro && 'ring-1 ring-primary/30 bg-primary/[0.04] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]',
        className
      )}
    >
      {children}
    </div>
  )
}

interface AiFieldActionProps {
  onClick: () => void
  disabled: boolean
  isLoading: boolean
  tooltipEnabled: string
  tooltipDisabled: string
  ariaLabel: string
  className?: string
}

export function AiFieldAction({
  onClick,
  disabled,
  isLoading,
  tooltipEnabled,
  tooltipDisabled,
  ariaLabel,
  className,
}: AiFieldActionProps) {
  const showDisabledTooltip = disabled && !isLoading

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              'absolute z-10 inline-flex',
              showDisabledTooltip && 'cursor-not-allowed',
              className
            )}
          />
        }
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onClick}
          disabled={disabled}
          aria-label={ariaLabel}
          className={cn(
            'h-8 gap-1.5 border-primary/40 bg-primary/15 px-2.5 text-primary shadow-sm',
            'hover:bg-primary/25 hover:text-primary disabled:pointer-events-none disabled:opacity-50'
          )}
        >
          {isLoading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Sparkles className="size-4" />
          )}
          <span className="text-[11px] font-bold uppercase tracking-wider">AI</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">
        {showDisabledTooltip ? tooltipDisabled : tooltipEnabled}
      </TooltipContent>
    </Tooltip>
  )
}

interface AiSuggestionPanelProps {
  children: ReactNode
  label?: string
  className?: string
}

export function AiSuggestionPanel({
  children,
  label = 'AI suggestion',
  className,
}: AiSuggestionPanelProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-primary/30 bg-primary/[0.06] p-3 space-y-2 shadow-sm',
        className
      )}
    >
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
        <Sparkles className="size-3.5" />
        {label}
      </div>
      {children}
    </div>
  )
}

interface AiProHintProps {
  children: ReactNode
}

export function AiProHint({ children }: AiProHintProps) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Sparkles className="size-3 text-primary/70" />
      {children}
    </p>
  )
}

export function AiFieldBadge() {
  return (
    <span className="inline-flex h-4 items-center gap-0.5 rounded-full border border-primary/40 bg-primary/10 px-1.5 text-[9px] font-bold uppercase tracking-wider text-primary">
      <Sparkles className="size-2.5" />
      AI
    </span>
  )
}

export function AiFieldBadgeIfPro() {
  const { isPro } = useAppUser()
  if (!isPro) return null
  return <AiFieldBadge />
}
