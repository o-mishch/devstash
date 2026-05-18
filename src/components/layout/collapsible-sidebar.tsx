'use client'

import { useState } from 'react'
import { SidebarContent } from './sidebar-content'

export function CollapsibleSidebar() {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <aside
      className={`hidden flex-col border-r border-border bg-muted/30 transition-all duration-200 lg:flex ${collapsed ? 'w-14' : 'w-56'}`}
    >
      <SidebarContent
        collapsed={collapsed}
        onToggle={() => setCollapsed((prev) => !prev)}
      />
    </aside>
  )
}
