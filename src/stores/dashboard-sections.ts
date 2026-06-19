import { create } from 'zustand'
import type { DashboardSections } from '@/types/editor-preferences'
import { DEFAULT_EDITOR_PREFERENCES } from '@/lib/utils/editor-preferences'
import { useEditorPreferencesStore } from '@/stores/editor-preferences'
import { readLayoutCookie, writeLayoutCookie } from '@/lib/utils/layout-cookie'

interface DashboardSectionsStore extends DashboardSections {
  setOpen: (section: keyof DashboardSections, open: boolean) => Promise<void>
  setSections: (sections: DashboardSections) => void
}

const defaultSections = DEFAULT_EDITOR_PREFERENCES.dashboardSections

// Seed from the ds-layout cookie so the client store already matches the persisted
// value at mount — the card renders the server-provided defaultOpen first, then adopts
// this store, and the two agree so there is no expand→collapse flash. Returns defaults
// on the server (no document), where the card uses defaultOpen instead.
const persisted = readLayoutCookie()

export const useDashboardSectionsStore = create<DashboardSectionsStore>((set, get) => ({
  collections: persisted.collections ?? defaultSections.collections,
  pinned: persisted.pinned ?? defaultSections.pinned,
  recent: persisted.recent ?? defaultSections.recent,
  setOpen: async (section, open) => {
    const prev = { collections: get().collections, pinned: get().pinned, recent: get().recent }
    const next = { ...prev, [section]: open }
    set(next)
    writeLayoutCookie({ [section]: open })

    // Persist through the editor-preferences store so its `dashboardSections` mirror stays in sync
    // and section toggles can't be clobbered by a later PATCH (e.g. a sidebar toggle) sending a
    // stale value. The store owns the PATCH, rollback toast, and the full request body.
    const ok = await useEditorPreferencesStore.getState().updatePreferences({ dashboardSections: next })
    if (!ok) {
      set(prev)
      writeLayoutCookie(prev)
    }
  },
  setSections: (sections) => {
    set(sections)
    writeLayoutCookie(sections)
  },
}))
