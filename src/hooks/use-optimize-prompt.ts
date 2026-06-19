'use client'

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api/client'
import { useUpdateItem } from '@/hooks/use-update-item'
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
 * explicit Apply, which OVERWRITES `item.content` (the original prompt), so the drawer guards close
 * while `hasUnsaved` is true and confirms before replacing. Applying reuses `useUpdateItem`, which
 * owns the `PATCH /items/{id}` write, the optimistic list/store cache sync, and rollback; `onSaved`
 * lets the drawer reflect the full updated item immediately (e.g. via `setSavedItem`).
 */
export function useOptimizePrompt(item: FullItem | null, onSaved?: (updated: FullItem) => void): OptimizeController {
  const updateItem = useUpdateItem()
  const [optimizedPrompt, setOptimizedPrompt] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isApplied, setIsApplied] = useState(false)
  const [replaceConfirmOpen, setReplaceConfirmOpen] = useState(false)

  const hasUnsaved = optimizedPrompt !== null && !isApplied

  const generate = useCallback(async () => {
    if (!item || isLoading) return

    // Warn when the prompt is longer than the model input cap — only the leading slice is optimized.
    if ((item.content?.length ?? 0) > OPTIMIZE_MAX_INPUT_CHARS) {
      toast.info(`Only the first ${OPTIMIZE_MAX_INPUT_CHARS.toLocaleString()} characters will be used for the optimization.`)
    }

    setIsLoading(true)

    // Only the id is sent — the route reads the canonical content from the DB.
    const { data, error } = await api.POST('/ai/optimize', {
      body: { itemId: item.id },
    })

    setIsLoading(false)

    if (error || !data) {
      toast.error(error?.message ?? 'Failed to optimize prompt.')
      return
    }

    setOptimizedPrompt(data.prompt)
    setIsApplied(false)
  }, [item, isLoading])

  const apply = useCallback(async (): Promise<boolean> => {
    if (!item || !optimizedPrompt || isSaving) return false
    setIsSaving(true)

    // Reuse useUpdateItem so the optimized prompt persists through the same PATCH + optimistic cache
    // sync (and rollback) as the edit form — only the content changes. onSave fires with the full
    // updated item, which carries the new content back to the open drawer (no stale prompt).
    let saved = false
    await updateItem(
      item,
      {
        title: item.title,
        description: item.description,
        content: optimizedPrompt,
        url: item.url,
        language: item.language,
        tags: item.tags,
        collectionIds: item.collections.map((c) => c.id),
      },
      {
        onSave: (updated) => {
          saved = true
          setIsApplied(true)
          onSaved?.(updated)
        },
        successMessage: 'Optimized prompt applied',
      },
    )

    setIsSaving(false)
    return saved
  }, [item, optimizedPrompt, isSaving, updateItem, onSaved])

  const requestApply = useCallback(() => {
    if (!optimizedPrompt || isSaving) return
    // Applying always replaces the existing prompt content — confirm first.
    setReplaceConfirmOpen(true)
  }, [optimizedPrompt, isSaving])

  const confirmReplace = useCallback(() => {
    setReplaceConfirmOpen(false)
    void apply()
  }, [apply])

  return {
    optimizedPrompt,
    isLoading,
    isSaving,
    isApplied,
    hasUnsaved,
    generate,
    apply,
    requestApply,
    replaceConfirmOpen,
    onReplaceConfirmOpenChange: setReplaceConfirmOpen,
    confirmReplace,
  }
}
