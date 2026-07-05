import { cn, getTypePlural } from '@/lib/utils'
import { PRO_ITEM_TYPE_NAMES } from '@/lib/utils/constants'
import { PRO_GATE_COPY } from '@/lib/utils/pro-gate'

export function getTypeHref(name: string) {
  return `/items/${getTypePlural(name)}`
}

export function sidebarLinkClass(active: boolean) {
  return cn(
    // touch: py-3 -> ~44px tall tap target, my-1 -> >=8px between adjacent
    // links (margins on the link itself, independent of the container's space-y).
    'group flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors touch:py-3 touch:my-1',
    active ? 'bg-foreground/10 text-foreground' : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground'
  )
}

interface ShowUpgradePrompt {
  (opts: { title: string; description: string }): void
}

export interface ProGateContext {
  isPro: boolean
  typeName: string
  showUpgradePrompt: ShowUpgradePrompt
}

// Blocks the nav and opens the shared "Pro Feature" dialog. `e` is duck-typed to avoid coupling to a
// specific React MouseEvent, so it works with standard DOM events or custom wrappers.
function openProGate(e: { preventDefault(): void }, showUpgradePrompt: ShowUpgradePrompt, description: string): true {
  e.preventDefault()
  showUpgradePrompt({ title: 'Pro Feature', description })
  return true
}

// Non-Pro users are gated off file/image regardless of any existing count, matching the edge gate in
// auth.config.ts (which redirects them unconditionally). The copy comes from the shared PRO_GATE_COPY,
// keyed by the type's plural slug (e.g. `file` → `files`), so click and redirect dialogs read identically.
export function handleProGatedTypeClick(e: { preventDefault(): void }, ctx: ProGateContext): boolean {
  if (!ctx.isPro && PRO_ITEM_TYPE_NAMES.has(ctx.typeName)) {
    return openProGate(e, ctx.showUpgradePrompt, PRO_GATE_COPY[getTypePlural(ctx.typeName) as keyof typeof PRO_GATE_COPY])
  }
  return false
}

export interface BrainDumpGateContext {
  isPro: boolean
  showUpgradePrompt: ShowUpgradePrompt
}

// Brain Dump is Pro-only but not an item type, so it gets its own gate: non-Pro users always see the
// same "Pro Feature" dialog as file/image instead of navigating to /parse.
export function handleBrainDumpClick(e: { preventDefault(): void }, ctx: BrainDumpGateContext): boolean {
  if (!ctx.isPro) {
    return openProGate(e, ctx.showUpgradePrompt, PRO_GATE_COPY['brain-dump'])
  }
  return false
}
