import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query'
import {
  getPreferencesOptions,
  updatePreferencesMutation,
} from '@/client/@tanstack/react-query.gen'
import type { EditorPreferences, ErrorModel, Options, UpdatePreferencesData } from '@/client'
import { toastMutationError } from '@/lib/api/errors'

// The prefs query key, resolved once so the query and the optimistic writers agree.
const preferencesKey = getPreferencesOptions().queryKey

/** The user's editor/app preferences (theme, color mode, skin, editor settings, sidebar). */
export function useEditorPreferences(): UseQueryResult<EditorPreferences, ErrorModel> {
  // Preferences change rarely and drive the whole app's chrome — keep them fresh for the
  // session rather than refetching on every window focus.
  return useQuery({ ...getPreferencesOptions(), staleTime: 5 * 60 * 1000 })
}

interface OptimisticContext {
  previous: EditorPreferences | undefined
}

/**
 * Patch preferences with an optimistic cache write so theme/skin/setting changes feel instant.
 * The server re-normalizes and returns the authoritative blob, which replaces the optimistic
 * value onSuccess; a failure rolls back to the pre-mutation snapshot.
 */
export function useUpdatePreferences(): UseMutationResult<
  EditorPreferences,
  ErrorModel,
  Options<UpdatePreferencesData>,
  OptimisticContext
> {
  const queryClient = useQueryClient()
  return useMutation({
    ...updatePreferencesMutation(),
    onMutate: async (variables): Promise<OptimisticContext> => {
      await queryClient.cancelQueries({ queryKey: preferencesKey })
      const previous = queryClient.getQueryData<EditorPreferences>(preferencesKey)
      if (previous) {
        queryClient.setQueryData<EditorPreferences>(preferencesKey, {
          ...previous,
          ...variables.body,
        })
      }
      return { previous }
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<EditorPreferences>(preferencesKey, updated)
    },
    onError: (error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData<EditorPreferences>(preferencesKey, context.previous)
      }
      toastMutationError(error)
    },
  })
}
