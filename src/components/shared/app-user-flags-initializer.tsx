'use client'

import { useLayoutEffect } from 'react'
import { useHydrateUserProfile, useUserProfile } from '@/hooks/profile/use-user-profile'

interface AppUserFlagsInitializerProps {
  isPro: boolean
  canCreateItem: boolean
  canCreateCollection: boolean
  name: string | null
  email: string | null
  image: string | null
}

export function AppUserFlagsInitializer({
  isPro,
  canCreateItem,
  canCreateCollection,
  name,
  email,
  image,
}: AppUserFlagsInitializerProps) {
  // Seed the /profile/me cache synchronously during render so sibling consumers (useIsPro() in item
  // cards, AI fields, the drawer) read the SSR flags on first paint instead of firing a redundant
  // GET /profile/me before the layout effect below runs. The effect still re-seeds on prop change
  // (client navigation) and writes the ds-pro cookie.
  useUserProfile({ initialData: { isPro, canCreateItem, canCreateCollection, name, email, image } })
  const hydrateUserProfile = useHydrateUserProfile()

  useLayoutEffect(() => {
    hydrateUserProfile({ isPro, canCreateItem, canCreateCollection, name, email, image })
    // Persist Pro status so the dashboard's route-level loading.tsx can pick the matching Pro/free
    // skin skeleton from a request-synchronous cookie (the free skins — aurora/editorial/classic —
    // can't infer Pro from the skin alone). Mirrors the ds-skin cookie written by ThemeInitializer.
    document.cookie = `ds-pro=${isPro ? '1' : '0'}; path=/; max-age=31536000; SameSite=Lax`
  }, [hydrateUserProfile, isPro, canCreateItem, canCreateCollection, name, email, image])

  return null
}
