'use client'

import { useMemo } from 'react'
import { useWatch, type UseFormReturn } from 'react-hook-form'
import {
  positiveOrUndefined,
  type ItemAiContextInput,
  type ItemFileContext,
} from '@/lib/ai/item-context'
import { useProbedImageDimensions } from '@/hooks/use-probed-image-dimensions'
import type { ItemFormBaseValues } from '@/lib/utils/validators'

interface UseItemAiContextParams {
  form: UseFormReturn<ItemFormBaseValues>
  itemContext: ItemFileContext
  imageProbeUrl?: string | null
}

function trimField(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed || undefined
}

export function useItemAiContext({
  form,
  itemContext,
  imageProbeUrl,
}: UseItemAiContextParams) {
  const title = useWatch({ control: form.control, name: 'title' }) ?? ''
  const content = useWatch({ control: form.control, name: 'content' }) ?? ''
  const url = useWatch({ control: form.control, name: 'url' }) ?? ''
  const language = useWatch({ control: form.control, name: 'language' }) ?? ''

  const shouldProbeImage =
    itemContext.itemType === 'image' &&
    !itemContext.imageWidth &&
    !itemContext.imageHeight &&
    Boolean(imageProbeUrl)

  const probedDimensions = useProbedImageDimensions(imageProbeUrl, shouldProbeImage)
  const imageWidth = itemContext.imageWidth ?? probedDimensions?.width
  const imageHeight = itemContext.imageHeight ?? probedDimensions?.height
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
      imageWidth: positiveOrUndefined(imageWidth),
      imageHeight: positiveOrUndefined(imageHeight),
    }),
    [itemContext.itemType, itemContext.fileSize, title, content, url, language, fileName, imageWidth, imageHeight]
  )

  return { payload }
}
