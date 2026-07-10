'use client'

import { useState, useCallback, memo, type ReactNode } from 'react'
import { Check, X, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  AiFieldAction,
  AiFieldFrame,
  AiProHint,
  AiSuggestionPanel,
} from '@/components/shared/ai-field-chrome'
import { useIsPro } from '@/hooks/profile/use-user-profile'
import { useAiFieldGenerate } from '@/hooks/ai/use-ai-field-generate'
import { aiRateLimitHint } from '@/lib/utils/constants'

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
  tooltip: string | null
  tooltipEnabled: string
}

export function useAiTagsField({ canGenerate, disabledReason, onGenerate }: UseAiTagsFieldParams): UseAiTagsFieldResult {
  const [suggestedTags, setSuggestedTags] = useState<string[]>([])

  const handleSuccess = useCallback((data: string[]) => {
    setSuggestedTags(data)
  }, [])

  const { isLoading, run } = useAiFieldGenerate({
    canGenerate,
    onGenerate,
    onStart: useCallback(() => setSuggestedTags([]), []),
    onSuccess: handleSuccess,
    failureMessage: 'Failed to generate tags.',
  })

  const disabled = isLoading || !canGenerate
  const tooltipEnabled = `Suggest tags with AI · ${aiRateLimitHint('tags')}`
  const tooltip = disabled ? (disabledReason ?? '') : tooltipEnabled

  return { isLoading, suggestedTags, setSuggestedTags, run, disabled, tooltip, tooltipEnabled }
}

interface AiTagsFieldProps {
  field: UseAiTagsFieldResult
  onAcceptTag: (tag: string) => void
  actionClassName: string
  children: ReactNode
}

interface SuggestedTagItemProps {
  tag: string
  onAccept: (tag: string) => void
  onReject: (tag: string) => void
}

const SuggestedTagItem = memo(function SuggestedTagItem({
  tag,
  onAccept,
  onReject,
}: SuggestedTagItemProps) {
  const handleAcceptClick = useCallback(() => {
    onAccept(tag)
  }, [tag, onAccept])

  const handleRejectClick = useCallback(() => {
    onReject(tag)
  }, [tag, onReject])

  return (
    <div
      className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-background/80 pl-2.5 pr-1 py-0.5"
    >
      <button
        type="button"
        onClick={handleAcceptClick}
        className="h-auto border-0 bg-transparent px-0 py-0 text-xs font-medium shadow-none text-foreground"
        aria-label={`Accept ${tag}`}
      >
        {tag}
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={handleAcceptClick}
        className="size-6 text-primary hover:text-primary"
        aria-label={`Accept ${tag}`}
      >
        <Check className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={handleRejectClick}
        className="size-6 text-muted-foreground hover:text-destructive"
        aria-label={`Dismiss ${tag}`}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  )
})

export const AiTagsField = memo(function AiTagsField({
  field,
  onAcceptTag,
  actionClassName,
  children,
}: AiTagsFieldProps) {
  const isPro = useIsPro()
  const { isLoading, suggestedTags, setSuggestedTags, run, disabled } = field

  const handleAccept = useCallback((tag: string) => {
    onAcceptTag(tag)
    setSuggestedTags(suggestedTags.filter((t) => t !== tag))
  }, [onAcceptTag, setSuggestedTags, suggestedTags])

  const handleReject = useCallback((tag: string) => {
    setSuggestedTags(suggestedTags.filter((t) => t !== tag))
  }, [setSuggestedTags, suggestedTags])

  return (
    <div className="space-y-2 w-full">
      <AiFieldFrame>
        {children}
        {isPro && (
          <AiFieldAction
            onClick={run}
            disabled={disabled}
            isLoading={isLoading}
            tooltipEnabled={field.tooltipEnabled}
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
                <SuggestedTagItem
                  key={tag}
                  tag={tag}
                  onAccept={handleAccept}
                  onReject={handleReject}
                />
              ))}
            </div>
          )}
        </AiSuggestionPanel>
      )}
    </div>
  )
})

export const AI_TAGS_INPUT_CLASS =
  'border-0 bg-transparent pr-16 shadow-none focus-visible:ring-0'
