import { create } from 'zustand'
import { toast } from 'sonner'
import type { EditorPreferences } from '@/types/editor-preferences'
import { DEFAULT_EDITOR_PREFERENCES } from '@/lib/utils/editor-preferences'
import { api } from '@/lib/api/client'

interface EditorPreferencesStore extends EditorPreferences {
  isInitialized: boolean
  updatePreference: <K extends keyof EditorPreferences>(key: K, value: EditorPreferences[K]) => Promise<void>
  updatePreferences: (prefs: Partial<EditorPreferences>) => Promise<void>
  setPreferences: (prefs: EditorPreferences) => void
}

export const useEditorPreferencesStore = create<EditorPreferencesStore>((set, get) => ({
  ...DEFAULT_EDITOR_PREFERENCES,
  isInitialized: false,
  updatePreference: async <K extends keyof EditorPreferences>(
    key: K,
    value: EditorPreferences[K]
  ) => {
    return get().updatePreferences({ [key]: value })
  },
  updatePreferences: async (prefs: Partial<EditorPreferences>) => {
    const prev = get()
    // Extract only EditorPreferences fields from state to prevent extra store fields leaking
    const newPrefs = {
      fontSize: prev.fontSize,
      tabSize: prev.tabSize,
      wordWrap: prev.wordWrap,
      minimap: prev.minimap,
      appTheme: prev.appTheme,
      colorMode: prev.colorMode,
      editorThemeMode: prev.editorThemeMode,
      dashboardSections: prev.dashboardSections,
      ...prefs,
    }
    set(newPrefs as Partial<EditorPreferencesStore>)

    try {
      const { error } = await api.PATCH('/profile/editor-preferences', {
        body: newPrefs,
      })
      if (error) throw new Error(error.message)
    } catch {
      set(prev)
      toast.error('Could not save editor preferences. Please try again.')
    }
  },
  setPreferences: (prefs) => {
    set({ ...prefs, isInitialized: true })
  },
}))
