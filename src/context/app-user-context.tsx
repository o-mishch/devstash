'use client'

import { createContext, useContext } from 'react'

export interface AppUserContextValue {
  isPro: boolean
  canCreateItem: boolean
  canCreateCollection: boolean
}

export const AppUserContext = createContext<AppUserContextValue>({
  isPro: false,
  canCreateItem: false,
  canCreateCollection: false,
})

export function useAppUser(): AppUserContextValue {
  return useContext(AppUserContext)
}
