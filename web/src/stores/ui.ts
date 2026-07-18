import { create } from 'zustand'

// Zustand holds UI-only state (the mobile sidebar drawer). Server state — session,
// items, collections — lives in TanStack Query, never here.
interface UIState {
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  toggleSidebar: () => void
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: false,
  setSidebarOpen: (open): void => set({ sidebarOpen: open }),
  toggleSidebar: (): void => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}))
