'use client'

import { useState } from 'react'
import type { SidebarData } from '@/types/sidebar'
import { CollapsedSidebar } from './collapsed-sidebar'
import { ExpandedSidebar } from './expanded-sidebar'

interface CollapsibleSidebarShellProps {
  sidebarData: SidebarData
}

export function CollapsibleSidebarShell({ sidebarData }: CollapsibleSidebarShellProps) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <aside
      className={`hidden flex-col border-r border-border bg-muted/30 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] lg:flex ${collapsed ? 'w-14' : 'w-56'} overflow-hidden`}
    >
      {collapsed ? (
        <CollapsedSidebar sidebarData={sidebarData} onToggle={() => setCollapsed(false)} />
      ) : (
        <ExpandedSidebar sidebarData={sidebarData} onToggle={() => setCollapsed(true)} />
      )}
    </aside>
  )
}
