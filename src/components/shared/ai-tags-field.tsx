'use client'

import { useState, useCallback, type ReactNode } from 'react'
import { Check, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  AiFieldAction,
  AiFieldFrame,
  AiProHint,
  AiSuggestionPanel,
} from '@/components/shared/ai-field-chrome'
import { useAppUser } from '@/context/app-user-context'
import { useAiFieldGenerate } from '@/hooks/use-ai-field-generate'
import type { ApiBody } from '@/types/api'

interface AiTagsFieldProps {
  canGenerate: boolean
  disabledReason: string | null
  onGenerate: () => Promise<ApiBody<string[] | null>>
  onAcceptTag: (tag: string) => void
  actionClassName: string
  children: ReactNode
}

export function AiTagsField({
  canGenerate,
  disabledReason,
  onGenerate,
  onAcceptTag,
  actionClassName,
  children,
}: AiTagsFieldProps) {
  const { isPro } = useAppUser()
  const [suggestedTags, setSuggestedTags] = useState<string[]>([])

  const handleSuccess = useCallback((tags: string[]) => {
    if (tags.length === 0) {
      toast.info('No tags suggested.')
    } else {
      setSuggestedTags(tags)
    }
  }, [])

  const { isLoading, run: handleSuggest } = useAiFieldGenerate({
    canGenerate,
    onGenerate,
    onStart: () => setSuggestedTags([]),
    onSuccess: handleSuccess,
    failureMessage: 'Failed to generate tags.',
  })

  const handleAccept = (tag: string) => {
    onAcceptTag(tag)
    setSuggestedTags((prev) => prev.filter((t) => t !== tag))
  }

  const handleReject = (tag: string) => {
    setSuggestedTags((prev) => prev.filter((t) => t !== tag))
  }

  return (
    <div className="space-y-2 w-full">
      <AiFieldFrame>
        {children}
        {isPro && (
          <AiFieldAction
            onClick={handleSuggest}
            disabled={!canGenerate || isLoading}
            isLoading={isLoading}
            tooltipEnabled="Suggest tags with AI"
            tooltipDisabled={disabledReason ?? ''}
            ariaLabel={isLoading ? 'Generating tags' : 'Suggest tags with AI'}
            className={actionClassName}
          />
        )}
      </AiFieldFrame>

      {!isPro && (
        <AiProHint>AI tag suggestions are available on Pro.</AiProHint>
      )}

      {suggestedTags.length > 0 && (
        <AiSuggestionPanel label="AI tags">
          <div className="flex flex-wrap gap-2">
            {suggestedTags.map((tag) => (
              <div
                key={tag}
                className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-background/80 pl-2.5 pr-1 py-0.5"
              >
                <Badge variant="secondary" className="h-auto border-0 bg-transparent px-0 py-0 text-xs font-medium shadow-none">
                  {tag}
                </Badge>
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
        </AiSuggestionPanel>
      )}
    </div>
  )
}

export const AI_TAGS_INPUT_CLASS =
  'border-0 bg-transparent pr-16 shadow-none focus-visible:ring-0'
