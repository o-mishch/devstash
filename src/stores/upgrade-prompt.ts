import { create } from 'zustand'

export interface UpgradePromptConfig {
  title: string
  description: string
  onUpgrade?: () => void
}

interface UpgradePromptStore {
  isOpen: boolean
  title: string | null
  description: string | null
  onUpgrade?: () => void
  openPrompt: (config: UpgradePromptConfig) => void
  closePrompt: () => void
}

export const useUpgradePromptStore = create<UpgradePromptStore>((set) => ({
  isOpen: false,
  title: null,
  description: null,
  openPrompt: (config) => set({
    isOpen: true,
    title: config.title,
    description: config.description,
    onUpgrade: config.onUpgrade,
  }),
  closePrompt: () => set({ isOpen: false, title: null, description: null, onUpgrade: undefined }),
}))
