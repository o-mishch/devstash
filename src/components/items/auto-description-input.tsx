'use client'

import { useCallback } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { Textarea } from '@/components/ui/textarea'
import { useAiMutation } from '@/hooks/use-ai-usage'
import {
  AiDescriptionField,
  useAiDescriptionField,
  AI_DESCRIPTION_INPUT_CLASS,
  type UseAiDescriptionFieldResult,
} from '@/components/shared/ai-description-field'
import { useItemAiContext } from '@/hooks/use-item-ai-context'
import type { ItemFileContext } from '@/lib/ai/item-context'
import type { ItemFormBaseValues } from '@/lib/utils/validators'

interface AutoDescriptionInputProps {
  form: UseFormReturn<ItemFormBaseValues>
  variant?: 'dialog' | 'drawer'
  aiField: UseAiDescriptionFieldResult
}

function getDisabledReason(
  itemType: string,
  title: string,
  content: string,
  url: string,
  fileName: string
): string | null {
  if (title || content || url || fileName) return null

  if (itemType === 'link') return 'Enter a title or URL first'
  if (itemType === 'file' || itemType === 'image') return 'Enter a title or upload a file first'
  return 'Enter a title or content first'
}

export function useAutoDescriptionField(
  form: UseFormReturn<ItemFormBaseValues>,
  itemContext: ItemFileContext
): UseAiDescriptionFieldResult {
  const { payload } = useItemAiContext({ form, itemContext })

  const disabledReason = getDisabledReason(
    itemContext.itemType,
    payload.title ?? '',
    payload.content ?? '',
    payload.url ?? '',
    payload.fileName ?? ''
  )
  const canGenerate = disabledReason === null

  const aiMutate = useAiMutation()
  const onGenerate = useCallback(async () => {
    const { data, error } = await aiMutate('/ai/description', payload)
    if (error) throw new Error(error.message)
    return data
  }, [aiMutate, payload])

  return useAiDescriptionField({ canGenerate, disabledReason, onGenerate })
}

export function AutoDescriptionInput({
  form,
  variant = 'dialog',
  aiField,
}: AutoDescriptionInputProps) {
  return (
    <AiDescriptionField
      field={aiField}
      onApply={(description) =>
        form.setValue('description', description, { shouldDirty: true, shouldValidate: true })
      }
      // Top-align the AI action since the field is a multi-line textarea in both variants.
      actionClassName="right-1.5 top-1.5"
    >
      {/* Textarea (not Input) so Enter / Ctrl+Enter inserts a newline instead of submitting the
          form. id is set only for the dialog variant, whose label uses htmlFor="description". */}
      <Textarea
        id={variant === 'dialog' ? 'description' : undefined}
        {...form.register('description')}
        placeholder="Optional description"
        // max-h caps the field-sizing-content auto-grow so a long description scrolls instead of
        // ballooning the dialog layout.
        className={`min-h-[3rem] max-h-44 resize-none ${AI_DESCRIPTION_INPUT_CLASS}`}
      />
    </AiDescriptionField>
  )
}
