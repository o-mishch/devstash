import { Code, Sparkles, Terminal, StickyNote, File, Image, Link } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const ICON_MAP: Record<string, LucideIcon> = {
  Code,
  Sparkles,
  Terminal,
  StickyNote,
  File,
  Image,
  Link,
}

function renderItemIcon(iconName: string, color: string, className: string) {
  const Icon = ICON_MAP[iconName]
  if (!Icon) return null
  return <Icon className={className} style={{ color }} />
}

interface ItemTypeIconProps {
  iconName: string
  color: string
  className?: string
}

export function ItemTypeIcon({ iconName, color, className = 'size-3' }: ItemTypeIconProps) {
  return renderItemIcon(iconName, color, className)
}
