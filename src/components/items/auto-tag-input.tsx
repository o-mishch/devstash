'use client'

import { useState } from 'react'
import { Sparkles, Check, X, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { generateAutoTags } from '@/actions/ai/generate-tags'
import { parseTagString } from '@/lib/utils/format'
import type { UseFormReturn } from 'react-hook-form'
import type { ItemFormBaseValues } from '@/lib/utils/validators'

interface AutoTagInputProps {
  form: UseFormReturn<ItemFormBaseValues>
  isPro: boolean
}

export function AutoTagInput({ form, isPro }: AutoTagInputProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [suggestedTags, setSuggestedTags] = useState<string[]>([])

  const handleSuggest = async () => {
    const title = form.getValues('title') || ''
    const content = form.getValues('content') || ''

    if (!title) {
      toast.error('Please enter a title first to get suggestions.')
      return
    }

    setIsLoading(true)
    setSuggestedTags([])

    try {
      const response = await generateAutoTags({ title, content })
      if (response.status === 'ok' && response.data) {
        if (response.data.length === 0) {
          toast.info('No tags suggested.')
        } else {
          setSuggestedTags(response.data)
        }
      } else {
        toast.error(response.message || 'Failed to generate tags.')
      }
    } catch {
      toast.error('An unexpected error occurred.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleAccept = (tag: string) => {
    const currentTags = form.getValues('tags') || ''
    const tagsArray = parseTagString(currentTags)
    if (!tagsArray.includes(tag)) {
      tagsArray.push(tag)
      form.setValue('tags', tagsArray.join(', '), { shouldDirty: true, shouldValidate: true })
    }
    setSuggestedTags(prev => prev.filter(t => t !== tag))
  }

  const handleReject = (tag: string) => {
    setSuggestedTags(prev => prev.filter(t => t !== tag))
  }

  return (
    <div className="space-y-3 w-full">
      <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          id="tags"
          placeholder="react, hooks, typescript"
          {...form.register('tags')}
          className="flex-1 min-w-0"
        />
        {isPro && (
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={handleSuggest}
            disabled={isLoading}
            className="w-full gap-2 sm:w-auto"
            title="Suggest Tags"
          >
            {isLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            <span>{isLoading ? 'Generating tags' : 'Suggest Tags'}</span>
          </Button>
        )}
      </div>

      {isPro ? (
        <p className="text-xs text-muted-foreground">
          AI suggestions appear below. Approve adds a tag to the input; reject removes it. Nothing is added automatically.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          AI tag suggestions are available on Pro.
        </p>
      )}

      {isLoading && (
        <div
          className="flex items-center gap-2 rounded-xl border border-border/70 bg-muted/30 px-4 py-3 text-sm text-muted-foreground shadow-sm"
          aria-live="polite"
        >
          <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
          <span>Generating AI tags… the model is preparing 3 to 5 suggestions.</span>
        </div>
      )}

      {suggestedTags.length > 0 && (
        <div className="rounded-xl border border-border/70 bg-background/80 p-3 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-primary" />
                <p className="text-sm font-medium text-foreground">Review AI suggestions</p>
              </div>
              <p className="text-xs text-muted-foreground">
                Click approve to add a tag to the input, or reject to dismiss it.
              </p>
            </div>
            <Badge variant="outline" className="shrink-0 border-border/70 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {suggestedTags.length} pending
            </Badge>
          </div>

          <div className="mt-3 grid gap-2">
            {suggestedTags.map(tag => (
              <div
                key={tag}
                className="flex flex-col gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <Badge variant="secondary" className="h-auto max-w-full justify-start rounded-full px-3 py-1 text-sm font-medium">
                  {tag}
                </Badge>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="xs"
                    onClick={() => handleAccept(tag)}
                    className="gap-1.5 text-emerald-700 hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200"
                  >
                    <Check className="size-3.5" />
                    Approve
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => handleReject(tag)}
                    className="gap-1.5 text-destructive hover:text-destructive"
                  >
                    <X className="size-3.5" />
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
