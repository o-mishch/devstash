'use client'

import { useCallback } from 'react'
import { api } from '@/lib/api/client'
import { useAiItemRewrite, type AiRewriteResult } from '@/hooks/use-ai-item-rewrite'
import { EXPLAIN_MAX_INPUT_CHARS } from '@/lib/utils/constants'
import type { FullItem } from '@/types/item'

export interface ExplainController {
  explanation: string | null
  isLoading: boolean
  isSaving: boolean
  isSaved: boolean
  // True while an explanation exists but hasn't been persisted to the description.
  hasUnsaved: boolean
  // True when saving would overwrite a non-empty description — drives the dialog copy.
  replacesExisting: boolean
  generate: () => Promise<void>
  // Persists the explanation to the item description; resolves true on success.
  save: () => Promise<boolean>
  // Save button entry point: confirms first when it would replace a non-empty description.
  requestSave: () => void
  replaceConfirmOpen: boolean
  onReplaceConfirmOpenChange: (open: boolean) => void
  confirmReplace: () => void
}

/**
 * Drives the drawer "Explain" affordance for a code item: calls `POST /ai/explain` and shows the
 * result in the Explain tab. The explanation is NOT auto-saved — the user persists it to
 * `item.description` via an explicit Save, so it survives reopen and surfaces in the Description
 * section. Confirms before replacing a non-empty description. Thin wrapper over `useAiItemRewrite`,
 * which owns the shared generate → confirm → save machine.
 */
export function useExplainCode(item: FullItem | null, onSaved?: (updated: FullItem) => void): ExplainController {
  const generate = useCallback(async (target: FullItem): Promise<AiRewriteResult> => {
    // Only the id is sent — the route reads the canonical content/language from the DB.
    const { data, error } = await api.POST('/ai/explain', { body: { itemId: target.id } })
    if (error || !data) return { ok: false, message: error?.message ?? 'Failed to explain code.' }
    return { ok: true, result: data.explanation }
  }, [])

  const controller = useAiItemRewrite({
    item,
    onSaved,
    maxInputChars: EXPLAIN_MAX_INPUT_CHARS,
    inputCapNoun: 'explanation',
    generate,
    targetField: 'description',
    successMessage: 'Explanation saved as description',
    alwaysConfirmReplace: false,
  })

  return {
    explanation: controller.result,
    isLoading: controller.isLoading,
    isSaving: controller.isSaving,
    isSaved: controller.isDone,
    hasUnsaved: controller.hasUnsaved,
    replacesExisting: controller.replacesExisting,
    generate: controller.generate,
    save: controller.save,
    requestSave: controller.requestSave,
    replaceConfirmOpen: controller.replaceConfirmOpen,
    onReplaceConfirmOpenChange: controller.onReplaceConfirmOpenChange,
    confirmReplace: controller.confirmReplace,
  }
}
