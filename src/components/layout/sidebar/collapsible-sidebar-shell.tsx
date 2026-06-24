'use client'

import { useState } from 'react'
import type { SidebarData } from '@/types/sidebar'
import { useUpdateEditorPreferences } from '@/hooks/use-editor-preferences'
import { writeLayoutCookie } from '@/lib/utils/layout-cookie'
import { CollapsedSidebar } from './collapsed-sidebar'
import { ExpandedSidebar } from './expanded-sidebar'

interface CollapsibleSidebarShellProps {
  sidebarData: SidebarData
  // Persisted collapsed state resolved on the server, so this matches the server-rendered markup
  // on the first client render (no hydration mismatch, no flash).
  initialCollapsed: boolean
}

export function CollapsibleSidebarShell({ sidebarData, initialCollapsed }: CollapsibleSidebarShellProps) {
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const updateEditorPreferences = useUpdateEditorPreferences()

  // Optimistically flip the rail, mirror the cookie for the pre-hydration no-flash path, and persist
  // to the DB (editorPreferences). Roll back the local state + cookie if the save fails.
  const toggleCollapsed = async (next: boolean) => {
    const prev = collapsed
    setCollapsed(next)
    writeLayoutCookie({ sidebar: next })

    const ok = await updateEditorPreferences({ sidebarCollapsed: next })
    if (!ok) {
      setCollapsed(prev)
      writeLayoutCookie({ sidebar: prev })
    }
  }

  return (
    <aside
      className={`hidden flex-col border-r border-border bg-muted/30 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] lg:flex ${collapsed ? 'w-14' : 'w-56'} overflow-hidden`}
    >
      {collapsed ? (
        <CollapsedSidebar sidebarData={sidebarData} onToggle={() => void toggleCollapsed(false)} />
      ) : (
        <ExpandedSidebar sidebarData={sidebarData} onToggle={() => void toggleCollapsed(true)} />
      )}
    </aside>
  )
}
