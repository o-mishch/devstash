'use client'

import { useState, useCallback, type ReactNode } from 'react'
import { Check, X, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  AiFieldAction,
  AiFieldFrame,
  AiProHint,
  AiSuggestionPanel,
} from '@/components/shared/ai-field-chrome'
import { useAppUserFlagsStore } from '@/stores/app-user-flags'
import { useAiFieldGenerate } from '@/hooks/use-ai-field-generate'
import { cn } from '@/lib/utils'

interface AiDescriptionResult {
  description: string
}

interface UseAiDescriptionFieldParams {
  canGenerate: boolean
  disabledReason: string | null
  onGenerate: () => Promise<AiDescriptionResult>
}

export interface UseAiDescriptionFieldResult {
  isLoading: boolean
  suggestedDescription: string | null
  setSuggestedDescription: (v: string | null) => void
  run: () => void
  disabled: boolean
  tooltip: string
}

export function useAiDescriptionField({
  canGenerate,
  disabledReason,
  onGenerate,
}: UseAiDescriptionFieldParams): UseAiDescriptionFieldResult {
  const [suggestedDescription, setSuggestedDescription] = useState<string | null>(null)

  const handleSuccess = useCallback((data: AiDescriptionResult) => {
    if (data.description) {
      setSuggestedDescription(data.description)
    } else {
      toast.error('Failed to generate description.')
    }
  }, [])

  const { isLoading, run } = useAiFieldGenerate({
    canGenerate,
    onGenerate,
    onStart: () => setSuggestedDescription(null),
    onSuccess: handleSuccess,
    failureMessage: 'Failed to generate description.',
  })

  const disabled = !canGenerate || isLoading
  const tooltip = disabled ? (disabledReason ?? '') : 'Generate description with AI'

  return { isLoading, suggestedDescription, setSuggestedDescription, run, disabled, tooltip }
}

interface AiDescriptionFieldProps {
  field: UseAiDescriptionFieldResult
  onApply: (description: string) => void
  actionClassName: string
  fill?: boolean
  children: ReactNode
}

export function AiDescriptionField({
  field,
  onApply,
  actionClassName,
  fill = false,
  children,
}: AiDescriptionFieldProps) {
  const { isPro } = useAppUserFlagsStore()
  const { isLoading, suggestedDescription, setSuggestedDescription, run, disabled } = field

  const handleUse = () => {
    if (!suggestedDescription) return
    onApply(suggestedDescription)
    setSuggestedDescription(null)
  }

  return (
    <div className={cn('w-full space-y-2', fill && 'flex min-h-0 flex-1 flex-col')}>
      <AiFieldFrame className={cn(fill && 'flex min-h-0 flex-1 flex-col')}>
        {children}
        {isPro && (
          <AiFieldAction
            onClick={run}
            disabled={disabled}
            isLoading={isLoading}
            tooltipEnabled="Generate description with AI"
            tooltipDisabled={field.tooltip}
            ariaLabel={isLoading ? 'Generating description' : 'Generate description with AI'}
            className={actionClassName}
          />
        )}
      </AiFieldFrame>

      {!isPro && (
        <AiProHint>AI description generation is available on Pro.</AiProHint>
      )}

      {(isLoading || suggestedDescription) && (
        <AiSuggestionPanel label="AI description">
          {isLoading ? (
            <div className="flex items-center gap-2 py-2">
              <Loader2 className="size-4 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">Generating description...</span>
            </div>
          ) : (
            <>
              <p className="text-sm leading-relaxed text-foreground">{suggestedDescription}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="xs"
                  onClick={handleUse}
                  className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  <Check className="size-3.5" />
                  Use
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => setSuggestedDescription(null)}
                  className="gap-1.5"
                >
                  <X className="size-3.5" />
                  Discard
                </Button>
              </div>
            </>
          )}
        </AiSuggestionPanel>
      )}
    </div>
  )
}

export const AI_DESCRIPTION_INPUT_CLASS =
  'border-0 bg-transparent pr-16 shadow-none focus-visible:ring-0'
