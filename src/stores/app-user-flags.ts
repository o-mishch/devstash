import { create } from 'zustand'

interface AppUserFlagsStore {
  isPro: boolean
  canCreateItem: boolean
  canCreateCollection: boolean
  setFlags: (flags: Partial<Omit<AppUserFlagsStore, 'setFlags'>>) => void
}

export const useAppUserFlagsStore = create<AppUserFlagsStore>((set) => ({
  isPro: false,
  canCreateItem: true,
  canCreateCollection: true,
  setFlags: (flags) => set(flags),
}))
