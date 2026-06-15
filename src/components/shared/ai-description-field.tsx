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

interface AiDescriptionResult {
  description: string
}

interface AiDescriptionFieldProps {
  canGenerate: boolean
  disabledReason: string | null
  onGenerate: () => Promise<AiDescriptionResult>
  onApply: (description: string) => void
  actionClassName: string
  children: ReactNode
}

export function AiDescriptionField({
  canGenerate,
  disabledReason,
  onGenerate,
  onApply,
  actionClassName,
  children,
}: AiDescriptionFieldProps) {
  const { isPro } = useAppUserFlagsStore()
  const [suggestedDescription, setSuggestedDescription] = useState<string | null>(null)

  const handleSuccess = useCallback((data: AiDescriptionResult) => {
    if (data.description) {
      setSuggestedDescription(data.description)
    } else {
      toast.error('Failed to generate description.')
    }
  }, [])

  const { isLoading, run: handleGenerate } = useAiFieldGenerate({
    canGenerate,
    onGenerate,
    onStart: () => setSuggestedDescription(null),
    onSuccess: handleSuccess,
    failureMessage: 'Failed to generate description.',
  })

  const handleUse = () => {
    if (!suggestedDescription) return
    onApply(suggestedDescription)
    setSuggestedDescription(null)
  }

  return (
    <div className="space-y-2 w-full">
      <AiFieldFrame>
        {children}
        {isPro && (
          <AiFieldAction
            onClick={handleGenerate}
            disabled={!canGenerate || isLoading}
            isLoading={isLoading}
            tooltipEnabled="Generate description with AI"
            tooltipDisabled={disabledReason ?? ''}
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
