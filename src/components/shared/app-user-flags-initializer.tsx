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
    // Persist Pro status so the dashboard's route-level loading.tsx can pick the matching Pro/free
    // skin skeleton from a request-synchronous cookie (the free skins — aurora/editorial/classic —
    // can't infer Pro from the skin alone). Mirrors the ds-skin cookie written by ThemeInitializer.
    document.cookie = `ds-pro=${isPro ? '1' : '0'}; path=/; max-age=31536000; SameSite=Lax`
  }, [isPro, canCreateItem, canCreateCollection])

  return null
}
