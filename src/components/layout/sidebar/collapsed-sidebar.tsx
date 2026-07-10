'use client'

import { memo, useCallback, type MouseEvent } from 'react'
import type { HTMLProps } from '@base-ui/react/types'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { PanelRight, Star, Settings, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn, getTypeLabel } from '@/lib/utils'
import { ItemTypeIcon } from '@/components/shared/item-type-icon'
import { PRO_ITEM_TYPE_NAMES } from '@/lib/utils/constants'
import type { SidebarData } from '@/types/sidebar'
import { useUpgradePromptStore } from '@/stores/upgrade-prompt'
import { useIsPro } from '@/hooks/profile/use-user-profile'
import { useCollections } from '@/hooks/items/use-collections'
import { UserDropdownMenuContent } from './user-dropdown'
import { getTypeHref, handleProGatedTypeClick, handleBrainDumpClick, type ProGateContext } from './utils'

interface CollapsedSidebarProps {
  sidebarData: SidebarData
  onToggle: () => void
}

// Fully static — every `TooltipTrigger` in this file wraps its Link/Button in a plain, non-interactive
// `<span>` so the Link/Button itself stays the real interactive element. A module-level function
// reference (not an inline arrow) is created once ever, satisfying both jsx-no-jsx-as-prop (function
// form, per Base UI's own composition docs) and jsx-no-new-function-as-prop (stable reference).
function renderSpanTrigger(props: HTMLProps) {
  return <span {...props} />
}

// Static Button render for the settings DropdownMenuTrigger — no per-render state, so this is hoisted
// rather than useCallback'd (there is nothing to memoize against).
function renderDropdownTriggerButton(props: HTMLProps) {
  return <Button {...props} variant="ghost" size="icon" className="text-muted-foreground" />
}

// Composes the two static renders above so the settings Tooltip's trigger element is the
// DropdownMenuTrigger (which itself renders as the Button) — mirrors the original nested element-form
// `render={<DropdownMenuTrigger render={<Button .../>} />}` exactly, just via the function form.
function renderSettingsTooltipTrigger(props: HTMLProps) {
  return <DropdownMenuTrigger {...props} render={renderDropdownTriggerButton} />
}

type ShowUpgradePrompt = ProGateContext['showUpgradePrompt']

interface SidebarItemTypeLinkProps {
  typeName: string
  typeHref: string
  icon: string
  color: string
  isCurrentPage: boolean
  isProGated: boolean
  isPro: boolean
  onOpenPrompt: ShowUpgradePrompt
}

// Extracted per-item subcomponent so the map loop below doesn't create a fresh onClick closure on every
// parent render — the closure now lives here, useCallback'd against this item's own (memo-stable) props.
const SidebarItemTypeLink = memo(function SidebarItemTypeLink({
  typeName,
  typeHref,
  icon,
  color,
  isCurrentPage,
  isProGated,
  isPro,
  onOpenPrompt,
}: SidebarItemTypeLinkProps) {
  const handleClick = useCallback(
    (e: MouseEvent<HTMLAnchorElement>) =>
      handleProGatedTypeClick(e, { isPro, typeName, showUpgradePrompt: onOpenPrompt }),
    [isPro, typeName, onOpenPrompt]
  )

  return (
    <Tooltip>
      <TooltipTrigger render={renderSpanTrigger}>
        <Link
          href={typeHref}
          // Eager-prefetch the route's RSC payload so navigation is instant; skip
          // Pro-gated routes for non-Pro users (they can't open them anyway).
          prefetch={!isProGated || isPro}
          onClick={handleClick}
          className={cn(
            'group flex size-11 items-center justify-center rounded-lg transition-colors',
            isCurrentPage
              ? 'bg-foreground/10 text-foreground'
              : 'hover:bg-foreground/5'
          )}
        >
          <ItemTypeIcon iconName={icon} color={color} className="size-4 shrink-0" />
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right">{getTypeLabel(typeName)}</TooltipContent>
    </Tooltip>
  )
})

export function CollapsedSidebar({ sidebarData, onToggle }: CollapsedSidebarProps) {
  const pathname = usePathname()
  const { openPrompt } = useUpgradePromptStore()
  const isPro = useIsPro()
  const { collections } = useCollections({ initialData: sidebarData.collections })
  const favoriteCollections = collections.filter((c) => c.isFavorite)

  const handleBrainDumpLinkClick = useCallback(
    (e: MouseEvent<HTMLAnchorElement>) => handleBrainDumpClick(e, { isPro, showUpgradePrompt: openPrompt }),
    [isPro, openPrompt]
  )

  return (
    <TooltipProvider delay={300}>
      <div className="flex h-full flex-col items-center py-2 overflow-hidden">
        <Button variant="ghost" size="icon" onClick={onToggle} className="group mb-2 text-muted-foreground">
          <PanelRight className="size-4 card-icon" />
        </Button>

        <Separator className="mb-2 w-8" />

        <ScrollArea className="flex-1 min-h-0 w-full [&_[data-slot=scroll-area-viewport]]:!overflow-x-hidden">
          <div className="flex flex-col items-center gap-1 px-2">
            <Tooltip>
              <TooltipTrigger render={renderSpanTrigger}>
                <Link
                  href="/parse"
                  // Non-Pro users can't open Brain Dump — block the nav and show the Pro gate; skip
                  // prefetch for them, matching the file/image type links below.
                  prefetch={isPro}
                  onClick={handleBrainDumpLinkClick}
                  className={cn(
                    'group flex size-11 items-center justify-center rounded-lg transition-colors',
                    pathname === '/parse' || pathname.startsWith('/parse/')
                      ? 'bg-foreground/10 text-foreground'
                      : 'hover:bg-foreground/5'
                  )}
                >
                  <Sparkles className="size-4 shrink-0 card-icon" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">Brain Dump</TooltipContent>
            </Tooltip>

            <Separator className="my-1 w-8" />

            {sidebarData.itemTypes.map((t) => {
              const typeHref = getTypeHref(t.name)

              return (
                <SidebarItemTypeLink
                  key={t.id}
                  typeName={t.name}
                  typeHref={typeHref}
                  icon={t.icon}
                  color={t.color}
                  isCurrentPage={pathname === typeHref}
                  isProGated={PRO_ITEM_TYPE_NAMES.has(t.name)}
                  isPro={isPro}
                  onOpenPrompt={openPrompt}
                />
              )
            })}

            {favoriteCollections.length > 0 && (
              <>
                <Separator className="my-1 w-8" />
                {favoriteCollections.map((c) => (
                  <Tooltip key={c.id}>
                    <TooltipTrigger render={renderSpanTrigger}>
                      <Link
                        href={`/collections/${c.id}`}
                        prefetch={true}
                        className={cn(
                          'flex size-11 items-center justify-center rounded-lg transition-colors',
                          pathname === `/collections/${c.id}`
                            ? 'bg-foreground/10 text-foreground'
                            : 'hover:bg-foreground/5'
                        )}
                      >
                        <Star className="size-4 shrink-0 fill-amber-400 text-amber-400" />
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent side="right">{c.name}</TooltipContent>
                  </Tooltip>
                ))}
              </>
            )}
          </div>
        </ScrollArea>

        <Separator className="mt-2 w-8" />
        <div className="py-2">
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger render={renderSettingsTooltipTrigger}>
                <Settings className="size-4" />
              </TooltipTrigger>
              <TooltipContent side="right">Settings</TooltipContent>
            </Tooltip>
            <UserDropdownMenuContent side="right" align="end" />
          </DropdownMenu>
        </div>
      </div>
    </TooltipProvider>
  )
}
