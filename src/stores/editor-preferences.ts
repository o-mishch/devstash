import { create } from 'zustand'
import type { EditorPreferences } from '@/types/editor-preferences'
import { DEFAULT_EDITOR_PREFERENCES } from '@/types/editor-preferences'
import { patch } from '@/lib/api/api-fetch'

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
      const res = await patch('/api/profile/editor-preferences', {
        fontSize,
        tabSize,
        wordWrap,
        minimap,
        theme,
        appTheme,
      })
      if (res.status !== 'ok') {
        set(prev)
      }
    } catch {
      set(prev)
    }
  },
  setPreferences: (prefs) => {
    set({ ...prefs, isInitialized: true })
  },
}))
