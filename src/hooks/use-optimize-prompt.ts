'use client'

import { useCallback } from 'react'
import { useAiMutation } from '@/hooks/use-ai-usage'
import { useAiItemRewrite, type AiRewriteResult } from '@/hooks/use-ai-item-rewrite'
import { OPTIMIZE_MAX_INPUT_CHARS } from '@/lib/utils/constants'
import type { FullItem } from '@/types/item'

export interface OptimizeController {
  optimizedPrompt: string | null
  isLoading: boolean
  isSaving: boolean
  isApplied: boolean
  // True while an optimized prompt exists but hasn't been applied to the item content.
  hasUnsaved: boolean
  generate: () => Promise<void>
  // Persists the optimized prompt to the item content; resolves true on success.
  apply: () => Promise<boolean>
  // Apply button entry point: always confirms first because applying overwrites the existing prompt.
  requestApply: () => void
  replaceConfirmOpen: boolean
  onReplaceConfirmOpenChange: (open: boolean) => void
  confirmReplace: () => void
}

/**
 * Drives the drawer "Optimize" affordance for a prompt item: calls `POST /ai/optimize` and shows the
 * result in the Optimized tab. The optimized prompt is NOT auto-saved — the user applies it via an
 * explicit Apply, which OVERWRITES `item.content` (the original prompt), so it always confirms first.
 * Thin wrapper over `useAiItemRewrite`, which owns the shared generate → confirm → save machine.
 */
export function useOptimizePrompt(item: FullItem | null, onSaved?: (updated: FullItem) => void): OptimizeController {
  const aiMutate = useAiMutation()
  const generate = useCallback(async (target: FullItem): Promise<AiRewriteResult> => {
    // Only the id is sent — the route reads the canonical content from the DB.
    const { data, error } = await aiMutate('/ai/optimize', { itemId: target.id })
    if (error || !data) return { ok: false, message: error?.message ?? 'Failed to optimize prompt.' }
    return { ok: true, result: data.prompt }
  }, [aiMutate])

  const controller = useAiItemRewrite({
    item,
    onSaved,
    maxInputChars: OPTIMIZE_MAX_INPUT_CHARS,
    inputCapNoun: 'optimization',
    generate,
    targetField: 'content',
    successMessage: 'Optimized prompt applied',
    alwaysConfirmReplace: true,
  })

  return {
    optimizedPrompt: controller.result,
    isLoading: controller.isLoading,
    isSaving: controller.isSaving,
    isApplied: controller.isDone,
    hasUnsaved: controller.hasUnsaved,
    generate: controller.generate,
    apply: controller.save,
    requestApply: controller.requestSave,
    replaceConfirmOpen: controller.replaceConfirmOpen,
    onReplaceConfirmOpenChange: controller.onReplaceConfirmOpenChange,
    confirmReplace: controller.confirmReplace,
  }
}
