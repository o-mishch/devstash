import { useState } from 'react'
import { readLayoutCookie, writeLayoutCookie } from '@/lib/layout-cookie'
import { useEditorPreferences, useUpdatePreferences } from './use-preferences'

interface SidebarCollapse {
  collapsed: boolean
  setCollapsed: (next: boolean) => void
}

/**
 * The desktop sidebar's collapsed state, persisted to `editorPreferences.sidebarCollapsed`.
 *
 * Preferences are the source of truth, but the query resolves after first paint — so the rail
 * would flash expanded on every cold load. The `ds-layout` cookie mirrors the saved value and is
 * read once on mount to seed the width until prefs arrive.
 *
 * The preferences mutation is already optimistic (it writes the cache in `onMutate`), so the flip
 * is instant and needs no local mirror state; a failed save rolls the cache back and we roll the
 * cookie back alongside it so the next cold load doesn't restore a width the server rejected.
 */
export function useSidebarCollapse(): SidebarCollapse {
  const { data: prefs } = useEditorPreferences()
  const update = useUpdatePreferences()
  const [seeded] = useState(() => readLayoutCookie().sidebar ?? false)
  const collapsed = prefs?.sidebarCollapsed ?? seeded

  const setCollapsed = (next: boolean): void => {
    const previous = collapsed
    writeLayoutCookie({ sidebar: next })
    update.mutate(
      { body: { sidebarCollapsed: next } },
      { onError: () => writeLayoutCookie({ sidebar: previous }) },
    )
  }

  return { collapsed, setCollapsed }
}
