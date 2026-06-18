import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface DashboardSectionsState {
  collections: boolean
  pinned: boolean
  recent: boolean
  setOpen: (section: 'collections' | 'pinned' | 'recent', open: boolean) => void
}

export const useDashboardSectionsStore = create<DashboardSectionsState>()(
  persist(
    (set) => ({
      collections: true,
      pinned: true,
      recent: true,
      setOpen: (section, open) => set({ [section]: open }),
    }),
    { name: 'devstash-dashboard-sections' }
  )
)
