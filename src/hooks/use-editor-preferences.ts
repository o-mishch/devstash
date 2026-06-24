'use client'

import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { $api, api } from '@/lib/api/client'
import { queryKeys } from '@/lib/api/query-keys'
import { DEFAULT_EDITOR_PREFERENCES } from '@/lib/utils/editor-preferences'
import type { EditorPreferences } from '@/types/editor-preferences'

// Shared so the two observers below (full prefs + the narrowed colorMode `select`) stay byte-identical:
// `enabled: false` (a pure cache subscription) + `staleTime: Infinity` (no autonomous refetch). The
// `undefined` init keys both to `['get','/profile/editor-preferences']` so the SSR seed reaches them.
const EDITOR_PREFS_QUERY_OPTIONS = { enabled: false, staleTime: Infinity } as const

export function useEditorPreferences() {
  // SSR-seeded by EditorPreferencesInitializer (setQueryData) and mutated optimistically by
  // useUpdateEditorPreferences — it never needs an autonomous network read (nothing invalidates it).
  // `enabled: false` makes it a pure cache subscription so consumers that mount before the hydrator
  // (ThemeInitializer, Toaster — rendered outside the suspended sidebar boundary) don't fire a
  // redundant GET. setQueryData still reaches disabled observers.
  // init MUST be `undefined` (not `{}`) so the observed key is `['get','/profile/editor-preferences']` —
  // the exact key the hydrator/optimistic update write via `setQueryData(queryKeys.editorPreferences())`.
  // A `{}` init keys differently and the disabled query would never receive the SSR seed.
  return $api.useQuery('get', '/profile/editor-preferences', undefined, EDITOR_PREFS_QUERY_OPTIONS)
}

/**
 * Editor preferences resolved against `DEFAULT_EDITOR_PREFERENCES` — never `undefined`, so consumers
 * read fields directly without re-implementing the `{ ...DEFAULT, ...prefs }` fallback at every site.
 */
export function useResolvedEditorPreferences(): EditorPreferences {
  const { data } = useEditorPreferences()
  return { ...DEFAULT_EDITOR_PREFERENCES, ...data }
}

/**
 * The resolved color mode only — a narrow `select` so subscribers (e.g. the global Toaster) re-render
 * only when the theme flips, not on every editor-preference change. Shares the same disabled,
 * SSR-seeded query as `useEditorPreferences` (see its note on the `undefined` init for key matching).
 */
export function useEditorColorMode(): EditorPreferences['colorMode'] {
  const { data } = $api.useQuery('get', '/profile/editor-preferences', undefined, {
    ...EDITOR_PREFS_QUERY_OPTIONS,
    select: (prefs) => prefs.colorMode,
  })
  return data ?? DEFAULT_EDITOR_PREFERENCES.colorMode
}

/** Seed the editor preferences cache from SSR-fetched data (called in EditorPreferencesInitializer). */
export function useHydrateEditorPreferences() {
  const queryClient = useQueryClient()
  return useCallback(
    (data: EditorPreferences) => {
      queryClient.setQueryData(queryKeys.editorPreferences(), data)
    },
    [queryClient],
  )
}

/**
 * Returns an async function that optimistically updates editor preferences and persists via PATCH.
 * Rolls back the cache and toasts on API error. Returns `true` on success, `false` on failure —
 * matching the old store API so callers can branch on the result.
 */
export function useUpdateEditorPreferences() {
  const queryClient = useQueryClient()
  return useCallback(
    async (prefs: Partial<EditorPreferences>): Promise<boolean> => {
      const current = queryClient.getQueryData<EditorPreferences>(queryKeys.editorPreferences())
      const newPrefs: EditorPreferences = { ...DEFAULT_EDITOR_PREFERENCES, ...current, ...prefs }
      queryClient.setQueryData(queryKeys.editorPreferences(), newPrefs)
      try {
        const { error } = await api.PATCH('/profile/editor-preferences', { body: newPrefs })
        if (error) throw new Error(error.message)
        return true
      } catch {
        // Restore the prior cache value — but only if it existed. Writing `undefined` would drop the
        // entry entirely and fall back to DEFAULT (worse than keeping the optimistic value). `current`
        // is normally seeded (prefs are edited after the SSR hydrator runs), so this only guards the race.
        if (current !== undefined) queryClient.setQueryData(queryKeys.editorPreferences(), current)
        toast.error('Could not save editor preferences. Please try again.')
        return false
      }
    },
    [queryClient],
  )
}
