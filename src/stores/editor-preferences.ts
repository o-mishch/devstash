import { create } from 'zustand'
import { toast } from 'sonner'
import type { EditorPreferences } from '@/types/editor-preferences'
import { DEFAULT_EDITOR_PREFERENCES } from '@/types/editor-preferences'
import { orpcClient } from '@/lib/api/client'

interface EditorPreferencesStore extends EditorPreferences {
  isInitialized: boolean
  updatePreference: <K extends keyof EditorPreferences>(key: K, value: EditorPreferences[K]) => Promise<void>
  setPreferences: (prefs: EditorPreferences) => void
}

export const useEditorPreferencesStore = create<EditorPreferencesStore>((set, get) => ({
  ...DEFAULT_EDITOR_PREFERENCES,
  isInitialized: false,
  updatePreference: async <K extends keyof EditorPreferences>(
    key: K,
    value: EditorPreferences[K]
  ) => {
    const prev = get()
    set({ [key]: value } as Partial<EditorPreferencesStore>)

    try {
      const { fontSize, tabSize, wordWrap, minimap, theme, appTheme } = get()
      await orpcClient.profile.updateEditorPreferences({ fontSize, tabSize, wordWrap, minimap, theme, appTheme })
    } catch {
      set(prev)
      toast.error('Could not save editor preferences. Please try again.')
    }
  },
  setPreferences: (prefs) => {
    set({ ...prefs, isInitialized: true })
  },
}))
