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

interface UseAiTagsFieldParams {
  canGenerate: boolean
  disabledReason: string | null
  onGenerate: () => Promise<string[]>
}

export interface UseAiTagsFieldResult {
  isLoading: boolean
  suggestedTags: string[]
  setSuggestedTags: (tags: string[]) => void
  run: () => void
  disabled: boolean
  tooltip: string
}

export function useAiTagsField({
  canGenerate,
  disabledReason,
  onGenerate,
}: UseAiTagsFieldParams): UseAiTagsFieldResult {
  const [suggestedTags, setSuggestedTags] = useState<string[]>([])

  const handleSuccess = useCallback((tags: string[]) => {
    if (tags.length === 0) {
      toast.info('No tags suggested.')
    } else {
      setSuggestedTags(tags)
    }
  }, [])

  const { isLoading, run } = useAiFieldGenerate({
    canGenerate,
    onGenerate,
    onStart: () => setSuggestedTags([]),
    onSuccess: handleSuccess,
    failureMessage: 'Failed to generate tags.',
  })

  const disabled = !canGenerate || isLoading
  const tooltip = disabled ? (disabledReason ?? '') : 'Suggest tags with AI'

  return { isLoading, suggestedTags, setSuggestedTags, run, disabled, tooltip }
}

interface AiTagsFieldProps {
  field: UseAiTagsFieldResult
  onAcceptTag: (tag: string) => void
  actionClassName: string
  children: ReactNode
}

export function AiTagsField({
  field,
  onAcceptTag,
  actionClassName,
  children,
}: AiTagsFieldProps) {
  const { isPro } = useAppUserFlagsStore()
  const { isLoading, suggestedTags, setSuggestedTags, run, disabled } = field

  const handleAccept = (tag: string) => {
    onAcceptTag(tag)
    setSuggestedTags(suggestedTags.filter((t) => t !== tag))
  }

  const handleReject = (tag: string) => {
    setSuggestedTags(suggestedTags.filter((t) => t !== tag))
  }

  return (
    <div className="space-y-2 w-full">
      <AiFieldFrame>
        {children}
        {isPro && (
          <AiFieldAction
            onClick={run}
            disabled={disabled}
            isLoading={isLoading}
            tooltipEnabled="Suggest tags with AI"
            tooltipDisabled={field.tooltip}
            ariaLabel={isLoading ? 'Generating tags' : 'Suggest tags with AI'}
            className={actionClassName}
          />
        )}
      </AiFieldFrame>

      {!isPro && (
        <AiProHint>AI tag suggestions are available on Pro.</AiProHint>
      )}

      {(isLoading || suggestedTags.length > 0) && (
        <AiSuggestionPanel label="AI tags">
          {isLoading ? (
            <div className="flex items-center gap-2 py-2">
              <Loader2 className="size-4 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">Generating tags...</span>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {suggestedTags.map((tag) => (
                <div
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-background/80 pl-2.5 pr-1 py-0.5"
                >
                  <button
                    type="button"
                    onClick={() => handleAccept(tag)}
                    className="h-auto border-0 bg-transparent px-0 py-0 text-xs font-medium shadow-none text-foreground"
                    aria-label={`Accept ${tag}`}
                  >
                    {tag}
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => handleAccept(tag)}
                    className="size-6 text-primary hover:text-primary"
                    aria-label={`Accept ${tag}`}
                  >
                    <Check className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => handleReject(tag)}
                    className="size-6 text-muted-foreground hover:text-destructive"
                    aria-label={`Dismiss ${tag}`}
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </AiSuggestionPanel>
      )}
    </div>
  )
}

export const AI_TAGS_INPUT_CLASS =
  'border-0 bg-transparent pr-16 shadow-none focus-visible:ring-0'
