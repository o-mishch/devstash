import { create } from 'zustand'
import { toast } from 'sonner'
import type { DashboardSections } from '@/types/editor-preferences'
import { DEFAULT_EDITOR_PREFERENCES } from '@/lib/utils/editor-preferences'
import { useEditorPreferencesStore } from '@/stores/editor-preferences'
import { writeLayoutCookie } from '@/lib/utils/layout-cookie'
import { api } from '@/lib/api/client'

interface DashboardSectionsStore extends DashboardSections {
  setOpen: (section: keyof DashboardSections, open: boolean) => Promise<void>
  setSections: (sections: DashboardSections) => void
}

const defaultSections = DEFAULT_EDITOR_PREFERENCES.dashboardSections

export const useDashboardSectionsStore = create<DashboardSectionsStore>((set, get) => ({
  collections: defaultSections.collections,
  pinned: defaultSections.pinned,
  recent: defaultSections.recent,
  setOpen: async (section, open) => {
    const prev = { collections: get().collections, pinned: get().pinned, recent: get().recent }
    const next = { ...prev, [section]: open }
    set(next)
    writeLayoutCookie({ [section]: open })

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
      writeLayoutCookie(prev)
      toast.error('Could not save layout preferences. Please try again.')
    }
  },
  setSections: (sections) => {
    set(sections)
    writeLayoutCookie(sections)
  },
}))
