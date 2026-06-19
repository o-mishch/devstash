import type { SidebarData } from '@/types/sidebar'
import { CollapsibleSidebarShell } from './sidebar/collapsible-sidebar-shell'
import { ExpandedSidebar } from './sidebar/expanded-sidebar'

interface SidebarContentProps {
  sidebarData: SidebarData
  onClose?: () => void
  collapsible?: boolean
  // Persisted collapsed state from editorPreferences (server-resolved) so the collapsible shell
  // renders the correct variant + width on first paint — no flash. Only used when collapsible.
  initialCollapsed?: boolean
}

export function SidebarContent({ sidebarData, onClose, collapsible = false, initialCollapsed = false }: SidebarContentProps) {
  if (collapsible) {
    return <CollapsibleSidebarShell sidebarData={sidebarData} initialCollapsed={initialCollapsed} />
  }

  return <ExpandedSidebar sidebarData={sidebarData} onClose={onClose} />
}
