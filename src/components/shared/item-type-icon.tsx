import { Code, MessageSquare, Terminal, StickyNote, File, Image, Link } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { SYSTEM_TYPE_COLORS, SYSTEM_TYPE_ICON_NAMES } from '@/lib/utils/constants'

export const ICON_MAP: Record<string, LucideIcon> = {
  Code,
  MessageSquare,
  Terminal,
  StickyNote,
  File,
  Image,
  Link,
}

interface ItemTypeIconProps {
  /** Resolve icon and color from system type name (preferred for list items) */
  typeName?: string
  /** Explicit icon name — used when the full ItemType is available (sidebar, collections) */
  iconName?: string
  color?: string | null
  className?: string
}

export function ItemTypeIcon({ typeName, iconName, color, className = 'size-3' }: ItemTypeIconProps) {
  const resolvedIconName = typeName ? SYSTEM_TYPE_ICON_NAMES[typeName] : iconName
  const resolvedColor = typeName ? SYSTEM_TYPE_COLORS[typeName] : color
  const Icon = resolvedIconName ? ICON_MAP[resolvedIconName] : null
  if (!Icon) return null
  return <Icon className={className} style={{ color: resolvedColor ?? undefined }} />
}
