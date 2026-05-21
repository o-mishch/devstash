import * as Icons from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export function getItemIcon(iconName: string): LucideIcon | null {
  const icon = Icons[iconName as keyof typeof Icons]
  return icon != null ? (icon as unknown as LucideIcon) : null
}
