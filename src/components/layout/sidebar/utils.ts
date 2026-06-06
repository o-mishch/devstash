import { cn, getTypeLabel, getTypePlural } from '@/lib/utils'
import { PRO_ITEM_TYPE_NAMES } from '@/lib/utils/constants'

export function getTypeHref(name: string) {
  return `/items/${getTypePlural(name)}`
}

export function sidebarLinkClass(active: boolean) {
  return cn(
    'flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors',
    active ? 'bg-foreground/10 text-foreground' : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground'
  )
}

export interface ProGateContext {
  isPro: boolean
  count: number
  typeName: string
  showUpgradePrompt: (opts: { title: string; description: string }) => void
}

// Uses a structural duck-type for the event to avoid requiring a specific React MouseEvent type,
// making the utility usable with different event sources (e.g. standard DOM events or custom wrappers).
export function handleProGatedTypeClick(e: { preventDefault(): void }, ctx: ProGateContext): boolean {
  if (!ctx.isPro && PRO_ITEM_TYPE_NAMES.has(ctx.typeName) && ctx.count === 0) {
    e.preventDefault()
    ctx.showUpgradePrompt({
      title: 'Pro Feature',
      description: `Creating ${getTypeLabel(ctx.typeName).toLowerCase()} is a Pro feature.`,
    })
    return true
  }
  return false
}
