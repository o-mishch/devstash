'use client'

import type { ReactNode } from 'react'
import { Sparkles, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useIsPro } from '@/hooks/use-user-profile'
import { cn } from '@/lib/utils'

interface AiFieldFrameProps {
  children: ReactNode
  className?: string
}

export function AiFieldFrame({ children, className }: AiFieldFrameProps) {
  const isPro = useIsPro()

  return (
    <div
      className={cn(
        'relative rounded-md transition-colors',
        isPro && 'border border-primary/30 bg-primary/[0.04] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]',
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
  const tooltipText = showDisabledTooltip ? tooltipDisabled : tooltipEnabled

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
            'h-7 gap-1.5 border-primary/40 bg-primary/15 px-2.5 text-primary shadow-sm',
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
      <TooltipContent side="top" className={tooltipText ? '' : 'hidden'}>
        {tooltipText}
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
        'card-surface card-hover group rounded-lg border border-primary/30 bg-primary/[0.06] p-3 space-y-2 shadow-sm',
        className
      )}
    >
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
        <Sparkles className="card-icon size-3.5" />
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

interface AiFieldBadgeProps {
  onClick?: () => void
  disabled?: boolean
  tooltip?: string
}

export function AiFieldBadge({ onClick, disabled, tooltip }: AiFieldBadgeProps) {
  const badge = (
    <span
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick && !disabled ? onClick : undefined}
      onKeyDown={onClick && !disabled ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick() } : undefined}
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 text-[10px] font-bold uppercase tracking-wider text-primary',
        onClick && !disabled && 'cursor-pointer hover:bg-primary/20',
        onClick && disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <Sparkles className="size-3" />
      AI
    </span>
  )

  if (!onClick) return badge

  return (
    <Tooltip>
      <TooltipTrigger render={<span className={cn(disabled && 'cursor-not-allowed')} />}>
        {badge}
      </TooltipTrigger>
      {tooltip && (
        <TooltipContent side="top">{tooltip}</TooltipContent>
      )}
    </Tooltip>
  )
}

export function AiFieldBadgeIfPro({ onClick, disabled, tooltip }: AiFieldBadgeProps) {
  const isPro = useIsPro()
  if (!isPro) return null
  return <AiFieldBadge onClick={onClick} disabled={disabled} tooltip={tooltip} />
}
