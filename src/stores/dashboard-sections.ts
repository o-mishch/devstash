import { create } from 'zustand'
import { toast } from 'sonner'
import type { DashboardSections } from '@/types/editor-preferences'
import { DEFAULT_EDITOR_PREFERENCES } from '@/lib/utils/editor-preferences'
import { useEditorPreferencesStore } from '@/stores/editor-preferences'
import { api } from '@/lib/api/client'

interface DashboardSectionsStore extends DashboardSections {
  setOpen: (section: keyof DashboardSections, open: boolean) => Promise<void>
  setSections: (sections: DashboardSections) => void
}

export const useDashboardSectionsStore = create<DashboardSectionsStore>((set, get) => ({
  ...DEFAULT_EDITOR_PREFERENCES.dashboardSections,
  setOpen: async (section, open) => {
    const prev = { collections: get().collections, pinned: get().pinned, recent: get().recent }
    const next = { ...prev, [section]: open }
    set(next)

    const editorPrefs = useEditorPreferencesStore.getState()
    try {
      const { error } = await api.PATCH('/profile/editor-preferences', {
        body: {
          fontSize: editorPrefs.fontSize,
          tabSize: editorPrefs.tabSize,
          wordWrap: editorPrefs.wordWrap,
          minimap: editorPrefs.minimap,
          appTheme: editorPrefs.appTheme,
          colorMode: editorPrefs.colorMode,
          editorThemeMode: editorPrefs.editorThemeMode,
          dashboardSections: next,
        },
      })
      if (error) throw new Error(error.message)
    } catch {
      set(prev)
      toast.error('Could not save layout preferences. Please try again.')
    }
  },
  setSections: (sections) => set(sections),
}))
