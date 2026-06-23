import { getTypeHref } from '@/components/layout/sidebar/utils'
import { SYSTEM_TYPE_COLORS, SYSTEM_TYPE_ICON_NAMES, SYSTEM_TYPE_ORDER } from '@/lib/utils/constants'
import { getTypeLabel } from '@/lib/utils/format'

export interface DashboardTypeShortcut {
  name: string
  label: string
  href: string
  icon: string
  color: string
}

export function getDashboardTypeShortcuts(): DashboardTypeShortcut[] {
  return SYSTEM_TYPE_ORDER.map((name) => ({
    name,
    label: getTypeLabel(name),
    href: getTypeHref(name),
    icon: SYSTEM_TYPE_ICON_NAMES[name],
    color: SYSTEM_TYPE_COLORS[name],
  }))
}
