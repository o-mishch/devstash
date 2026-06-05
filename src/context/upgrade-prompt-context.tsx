'use client'

import { createContext, useContext } from 'react'

export interface UpgradePromptConfig {
  title: string
  description: string
  onUpgrade?: () => void
}

interface UpgradePromptContextValue {
  showUpgradePrompt: (config: UpgradePromptConfig) => void
}

export const UpgradePromptContext = createContext<UpgradePromptContextValue>({
  showUpgradePrompt: () => {},
})

export function useUpgradePrompt() {
  return useContext(UpgradePromptContext)
}
