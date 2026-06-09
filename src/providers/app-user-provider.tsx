'use client'

import { AppUserContext, type AppUserContextValue } from '@/context/app-user-context'
import type { WithChildren } from '@/types/common'

interface AppUserProviderProps extends WithChildren, AppUserContextValue {}

export function AppUserProvider({
  isPro,
  canCreateItem,
  canCreateCollection,
  children,
}: AppUserProviderProps) {
  return (
    <AppUserContext.Provider value={{ isPro, canCreateItem, canCreateCollection }}>
      {children}
    </AppUserContext.Provider>
  )
}
