'use client'

import { useCallback } from 'react'
import { Tag } from 'lucide-react'
import type { UseFormReturn } from 'react-hook-form'
import { Input } from '@/components/ui/input'
import { useAiMutation } from '@/hooks/ai/use-ai-usage'
import { parseTagString } from '@/lib/utils/format'
import { AiFieldBadgeIfPro } from '@/components/shared/ai-field-chrome'
import { AiTagsField, useAiTagsField, AI_TAGS_INPUT_CLASS } from '@/components/shared/ai-tags-field'
import { useItemAiContext } from '@/hooks/ai/use-item-ai-context'
import type { ItemFileContext } from '@/lib/ai/item-context'
import type { ItemFormBaseValues } from '@/lib/utils/validators'

interface AutoTagInputProps {
  form: UseFormReturn<ItemFormBaseValues>
  itemContext: ItemFileContext
  variant?: 'dialog' | 'drawer'
  error?: string
}

function getDisabledReason(title: string, fileName: string): string | null {
  if (title || fileName) return null
  return 'Enter a title or upload a file to suggest tags'
}

export function AutoTagInput({
  form,
  itemContext,
  variant = 'dialog',
  error,
}: AutoTagInputProps) {
  const { payload } = useItemAiContext({
    form,
    itemContext,
  })
  const canSuggest = Boolean(payload.title || payload.fileName)
  const disabledReason = getDisabledReason(payload.title ?? '', payload.fileName ?? '')

  const aiMutate = useAiMutation()
  const onGenerate = useCallback(async () => {
    const { data, error } = await aiMutate('/ai/tags', payload)
    if (error) throw new Error(error.message)
    return data
  }, [aiMutate, payload])

  const aiField = useAiTagsField({ canGenerate: canSuggest, disabledReason, onGenerate })

  const handleAcceptTag = useCallback((tag: string) => {
    const currentTags = form.getValues('tags') || ''
    const tagsArray = parseTagString(currentTags)
    if (!tagsArray.includes(tag)) {
      tagsArray.push(tag)
      form.setValue('tags', tagsArray.join(', '), { shouldDirty: true, shouldValidate: true })
    }
  }, [form])

  const field = (
    <AiTagsField
      field={aiField}
      onAcceptTag={handleAcceptTag}
      actionClassName="right-1.5 top-1/2 -translate-y-1/2"
    >
      <Input
        id="tags"
        placeholder="react, hooks, typescript"
        {...form.register('tags')}
        className={AI_TAGS_INPUT_CLASS}
      />
    </AiTagsField>
  )

  if (variant === 'drawer') {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Tag className="size-3" />
          <span>Tags</span>
          <AiFieldBadgeIfPro
            onClick={aiField.run}
            disabled={aiField.disabled}
            tooltip={aiField.tooltip}
          />
        </div>
        {field}
        {error && <p className="text-red-500 text-[10px]">{error}</p>}
        <p className="text-xs text-muted-foreground">Comma-separated</p>
      </div>
    )
  }

  return (
    <div className="grid min-w-0 gap-2">
      <label htmlFor="tags" className="flex items-center gap-2 text-sm font-medium leading-none">
        Tags
        <AiFieldBadgeIfPro
          onClick={aiField.run}
          disabled={aiField.disabled}
          tooltip={aiField.tooltip}
        />
      </label>
      {field}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  )
}
