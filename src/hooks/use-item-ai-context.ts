'use client'

import { useMemo } from 'react'
import { useWatch, type UseFormReturn } from 'react-hook-form'
import {
  positiveOrUndefined,
  type ItemAiContextInput,
  type ItemFileContext,
} from '@/lib/ai/item-context'
import type { ItemFormBaseValues } from '@/lib/utils/validators'

interface UseItemAiContextParams {
  form: UseFormReturn<ItemFormBaseValues>
  itemContext: ItemFileContext
}

function trimField(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed || undefined
}

export function useItemAiContext({ form, itemContext }: UseItemAiContextParams) {
  const title = useWatch({ control: form.control, name: 'title' }) ?? ''
  const content = useWatch({ control: form.control, name: 'content' }) ?? ''
  const url = useWatch({ control: form.control, name: 'url' }) ?? ''
  const language = useWatch({ control: form.control, name: 'language' }) ?? ''
  const fileName = itemContext.fileName?.trim() ?? ''

  const payload = useMemo<ItemAiContextInput>(
    () => ({
      itemType: itemContext.itemType,
      title: trimField(title),
      content: trimField(content),
      url: trimField(url),
      language: trimField(language),
      fileName: fileName || undefined,
      fileSize: positiveOrUndefined(itemContext.fileSize),
    }),
    [itemContext.itemType, itemContext.fileSize, title, content, url, language, fileName]
  )

  return { payload }
}
