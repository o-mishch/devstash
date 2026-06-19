'use client'

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api/client'
import { useUpdateItem } from '@/hooks/use-update-item'
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
 * section. The drawer guards close while `hasUnsaved` is true. Saving reuses `useUpdateItem`, which
 * owns the `PATCH /items/{id}` write, the optimistic list/store cache sync, and rollback; `onSaved`
 * lets the drawer reflect the full updated item immediately (e.g. via `setSavedItem`).
 */
export function useExplainCode(item: FullItem | null, onSaved?: (updated: FullItem) => void): ExplainController {
  const updateItem = useUpdateItem()
  const [explanation, setExplanation] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isSaved, setIsSaved] = useState(false)
  const [replaceConfirmOpen, setReplaceConfirmOpen] = useState(false)

  const replacesExisting = Boolean(item?.description && item.description.trim().length > 0)
  const hasUnsaved = explanation !== null && !isSaved

  const generate = useCallback(async () => {
    if (!item || isLoading) return

    // Warn when the code is longer than the model input cap — only the leading slice is explained.
    if ((item.content?.length ?? 0) > EXPLAIN_MAX_INPUT_CHARS) {
      toast.info(`Only the first ${EXPLAIN_MAX_INPUT_CHARS.toLocaleString()} characters will be used for the explanation.`)
    }

    setIsLoading(true)

    // Only the id is sent — the route reads the canonical content/language from the DB.
    const { data, error } = await api.POST('/ai/explain', {
      body: { itemId: item.id },
    })

    setIsLoading(false)

    if (error || !data) {
      toast.error(error?.message ?? 'Failed to explain code.')
      return
    }

    setExplanation(data.explanation)
    setIsSaved(false)
  }, [item, isLoading])

  const save = useCallback(async (): Promise<boolean> => {
    if (!item || !explanation || isSaving) return false
    setIsSaving(true)

    // Reuse useUpdateItem so the explanation persists through the same PATCH + optimistic cache sync
    // (and rollback) as the edit form — only the description changes. onSave fires with the full
    // updated item, which carries the new description back to the open drawer (no stale Description).
    let saved = false
    await updateItem(
      item,
      {
        title: item.title,
        description: explanation,
        content: item.content,
        url: item.url,
        language: item.language,
        tags: item.tags,
        collectionIds: item.collections.map((c) => c.id),
      },
      {
        onSave: (updated) => {
          saved = true
          setIsSaved(true)
          onSaved?.(updated)
        },
        successMessage: 'Explanation saved as description',
      },
    )

    setIsSaving(false)
    return saved
  }, [item, explanation, isSaving, updateItem, onSaved])

  const requestSave = useCallback(() => {
    if (!explanation || isSaving) return
    // Confirm before clobbering an existing description; otherwise persist straight away.
    if (replacesExisting) {
      setReplaceConfirmOpen(true)
    } else {
      void save()
    }
  }, [explanation, isSaving, replacesExisting, save])

  const confirmReplace = useCallback(() => {
    setReplaceConfirmOpen(false)
    void save()
  }, [save])

  return {
    explanation,
    isLoading,
    isSaving,
    isSaved,
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
