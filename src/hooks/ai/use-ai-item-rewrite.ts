'use client'

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { useUpdateItem } from '@/hooks/items/use-update-item'
import type { FullItem } from '@/types/item'

// Result of a single AI generation call: the produced text, or a user-facing error message.
export type AiRewriteResult = { ok: true; result: string } | { ok: false; message: string }

export interface AiItemRewriteConfig {
  item: FullItem | null
  // Fires with the full updated item after the AI result is persisted (e.g. drawer setSavedItem).
  onSaved?: (updated: FullItem) => void
  // Model input cap; a heads-up toast warns when item content exceeds it before generating.
  maxInputChars: number
  // Noun for the input-cap warning copy, e.g. 'explanation' / 'optimization'.
  inputCapNoun: string
  // Performs the AI request (owns the typed route path + response field) and maps it to a result.
  generate: (item: FullItem) => Promise<AiRewriteResult>
  // Which item field the result is persisted into via useUpdateItem.
  targetField: 'description' | 'content'
  // Success toast copy after the result is saved.
  successMessage: string
  // When true the save always confirms first (it overwrites existing content); when false it only
  // confirms if it would replace a non-empty target field.
  alwaysConfirmReplace: boolean
}

export interface AiItemRewriteController {
  result: string | null
  isLoading: boolean
  isSaving: boolean
  isDone: boolean
  // True while a result exists but hasn't been persisted to the item.
  hasUnsaved: boolean
  // True when saving would overwrite a non-empty target field — drives the dialog copy.
  replacesExisting: boolean
  generate: () => Promise<void>
  // Persists the result to the item; resolves true on success.
  save: () => Promise<boolean>
  // Save button entry point: confirms first when required, otherwise persists straight away.
  requestSave: () => void
  replaceConfirmOpen: boolean
  onReplaceConfirmOpenChange: (open: boolean) => void
  confirmReplace: () => void
}

/**
 * Shared controller for the drawer AI rewrite affordances ("Explain" for code → description,
 * "Optimize" for prompts → content). Owns the generate → confirm-replace → save machine: it calls
 * the configured AI route, holds the result unsaved until an explicit Save, and persists through
 * `useUpdateItem` (the same `PATCH /items/{id}` write + optimistic cache sync + rollback as the edit
 * form). The result is never auto-saved, so the drawer can guard close while `hasUnsaved` is true.
 */
export function useAiItemRewrite(config: AiItemRewriteConfig): AiItemRewriteController {
  const { item, onSaved, maxInputChars, inputCapNoun, generate: runGenerate, targetField, successMessage, alwaysConfirmReplace } = config
  const updateItem = useUpdateItem()
  const [result, setResult] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isDone, setIsDone] = useState(false)
  const [replaceConfirmOpen, setReplaceConfirmOpen] = useState(false)

  const existing = targetField === 'description' ? item?.description : item?.content
  const replacesExisting = Boolean(existing && existing.trim().length > 0)
  const hasUnsaved = result !== null && !isDone

  const generate = useCallback(async () => {
    if (!item || isLoading) return

    // Warn when the content is longer than the model input cap — only the leading slice is used.
    if ((item.content?.length ?? 0) > maxInputChars) {
      toast.info(`Only the first ${maxInputChars.toLocaleString()} characters will be used for the ${inputCapNoun}.`)
    }

    setIsLoading(true)
    const outcome = await runGenerate(item)
    setIsLoading(false)

    if (!outcome.ok) {
      toast.error(outcome.message)
      return
    }

    setResult(outcome.result)
    setIsDone(false)
  }, [item, isLoading, maxInputChars, inputCapNoun, runGenerate])

  const save = useCallback(async (): Promise<boolean> => {
    if (!item || result === null || isSaving) return false
    setIsSaving(true)

    // Reuse useUpdateItem so the result persists through the same PATCH + optimistic cache sync (and
    // rollback) as the edit form — only the target field changes. onSave fires with the full updated
    // item, which carries the new value back to the open drawer (no stale view).
    let saved = false
    await updateItem(
      item,
      {
        title: item.title,
        description: targetField === 'description' ? result : item.description,
        content: targetField === 'content' ? result : item.content,
        url: item.url,
        language: item.language,
        tags: item.tags,
        collectionIds: item.collections.map((c) => c.id),
      },
      {
        onSave: (updated) => {
          saved = true
          setIsDone(true)
          onSaved?.(updated)
        },
        successMessage,
      },
    )

    setIsSaving(false)
    return saved
  }, [item, result, isSaving, updateItem, onSaved, targetField, successMessage])

  const requestSave = useCallback(() => {
    if (result === null || isSaving) return
    // Confirm before clobbering existing content; otherwise persist straight away.
    if (alwaysConfirmReplace || replacesExisting) {
      setReplaceConfirmOpen(true)
    } else {
      void save()
    }
  }, [result, isSaving, alwaysConfirmReplace, replacesExisting, save])

  const confirmReplace = useCallback(() => {
    setReplaceConfirmOpen(false)
    void save()
  }, [save])

  return {
    result,
    isLoading,
    isSaving,
    isDone,
    hasUnsaved,
    replacesExisting,
    generate,
    save,
    requestSave,
    replaceConfirmOpen,
    onReplaceConfirmOpenChange: setReplaceConfirmOpen,
    confirmReplace,
  }
}
