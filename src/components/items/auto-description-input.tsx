'use client'

import { useCallback } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { generateDescription } from '@/actions/ai/generate-descriptions'
import {
  AiDescriptionField,
  AI_DESCRIPTION_INPUT_CLASS,
} from '@/components/shared/ai-description-field'
import { useItemAiContext } from '@/hooks/use-item-ai-context'
import type { ItemFileContext } from '@/lib/ai/item-context'
import type { ItemFormBaseValues } from '@/lib/utils/validators'

interface AutoDescriptionInputProps {
  form: UseFormReturn<ItemFormBaseValues>
  itemContext: ItemFileContext
  imageProbeUrl?: string | null
  variant?: 'dialog' | 'drawer'
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

export function AutoDescriptionInput({
  form,
  itemContext,
  imageProbeUrl,
  variant = 'dialog',
}: AutoDescriptionInputProps) {
  const { payload } = useItemAiContext({
    form,
    itemContext,
    imageProbeUrl,
  })

  const disabledReason = getDisabledReason(
    itemContext.itemType,
    payload.title ?? '',
    payload.content ?? '',
    payload.url ?? '',
    payload.fileName ?? ''
  )
  const canGenerate = disabledReason === null

  const onGenerate = useCallback(() => generateDescription(payload), [payload])

  const inputProps = form.register('description')
  const actionClassName =
    variant === 'drawer'
      ? 'right-1.5 top-1.5'
      : 'right-1.5 top-1/2 -translate-y-1/2'

  return (
    <AiDescriptionField
      canGenerate={canGenerate}
      disabledReason={disabledReason}
      onGenerate={onGenerate}
      onApply={(description) =>
        form.setValue('description', description, { shouldDirty: true, shouldValidate: true })
      }
      actionClassName={actionClassName}
    >
      {variant === 'drawer' ? (
        <Textarea
          {...inputProps}
          placeholder="Optional description"
          className={`min-h-[3rem] resize-none ${AI_DESCRIPTION_INPUT_CLASS}`}
        />
      ) : (
        <Input
          id="description"
          placeholder="Optional description"
          {...inputProps}
          className={AI_DESCRIPTION_INPUT_CLASS}
        />
      )}
    </AiDescriptionField>
  )
}
