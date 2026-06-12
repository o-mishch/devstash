'use client'

import { useLayoutEffect } from 'react'
import { useAppUserFlagsStore } from '@/stores/app-user-flags'

interface AppUserFlagsInitializerProps {
  isPro: boolean
  canCreateItem: boolean
  canCreateCollection: boolean
}

export function AppUserFlagsInitializer({
  isPro,
  canCreateItem,
  canCreateCollection,
}: AppUserFlagsInitializerProps) {
  useLayoutEffect(() => {
    useAppUserFlagsStore.setState({
      isPro,
      canCreateItem,
      canCreateCollection,
    })
  }, [isPro, canCreateItem, canCreateCollection])

  return null
}
