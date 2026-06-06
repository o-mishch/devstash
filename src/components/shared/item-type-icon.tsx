import { Code, Sparkles, Terminal, StickyNote, File, Image, Link } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export const ICON_MAP: Record<string, LucideIcon> = {
  Code,
  Sparkles,
  Terminal,
  StickyNote,
  File,
  Image,
  Link,
}

interface ItemTypeIconProps {
  iconName: string
  color?: string | null
  className?: string
}

export function ItemTypeIcon({ iconName, color, className = 'size-3' }: ItemTypeIconProps) {
  const Icon = ICON_MAP[iconName]
  if (!Icon) return null
  return <Icon className={className} style={{ color: color ?? undefined }} />
}
