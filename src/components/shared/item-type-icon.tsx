import { Code, MessageSquare, Terminal, StickyNote, File, Image, Link } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { SYSTEM_TYPE_COLORS, SYSTEM_TYPE_ICON_NAMES } from '@/lib/utils/constants'
import { cn } from '@/lib/utils'

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
  // `card-icon` so the icon grows when its enclosing card (.card-interactive / .group) is hovered —
  // the app-wide icon-grow affordance, applied centrally here rather than on every card.
  return <Icon className={cn('card-icon', className)} style={{ color: resolvedColor ?? undefined }} />
}
