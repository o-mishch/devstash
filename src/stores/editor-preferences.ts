import { create } from 'zustand'
import type { EditorPreferences } from '@/types/editor-preferences'
import { DEFAULT_EDITOR_PREFERENCES } from '@/types/editor-preferences'

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
      // Dynamic import to avoid circular dependency with settings action
      const { updateEditorPreferencesAction } = await import('@/actions/settings')
      const { fontSize, tabSize, wordWrap, minimap, theme, appTheme } = get()
      const res = await updateEditorPreferencesAction({
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
