import type { SidebarData } from '@/types/sidebar'
import { CollapsibleSidebarShell } from './sidebar/collapsible-sidebar-shell'
import { ExpandedSidebar } from './sidebar/expanded-sidebar'

interface SidebarContentProps {
  sidebarData: SidebarData
  onClose?: () => void
  collapsible?: boolean
}

export function SidebarContent({ sidebarData, onClose, collapsible = false }: SidebarContentProps) {
  if (collapsible) {
    return <CollapsibleSidebarShell sidebarData={sidebarData} />
  }

  return <ExpandedSidebar sidebarData={sidebarData} onClose={onClose} />
}
