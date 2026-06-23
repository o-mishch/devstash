'use client'

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
import { UserDropdownMenuContent } from './user-dropdown'
import { getTypeHref, handleProGatedTypeClick } from './utils'

interface CollapsedSidebarProps {
  sidebarData: SidebarData
  onToggle: () => void
}

export function CollapsedSidebar({ sidebarData, onToggle }: CollapsedSidebarProps) {
  const pathname = usePathname()
  const { openPrompt } = useUpgradePromptStore()
  const favoriteCollections = sidebarData.collections.filter((c) => c.isFavorite)

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
              <TooltipTrigger render={<span />}>
                <Link
                  href="/parse"
                  prefetch={true}
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
              const isCurrentPage = pathname === typeHref
              const isPro = sidebarData.user?.isPro ?? false
              const isProGated = PRO_ITEM_TYPE_NAMES.has(t.name)

              return (
              <Tooltip key={t.id}>
                <TooltipTrigger render={<span />}>
                  <Link
                    href={typeHref}
                    // Eager-prefetch the route's RSC payload so navigation is instant; skip
                    // Pro-gated routes for non-Pro users (they can't open them anyway).
                    prefetch={!isProGated || isPro}
                    onClick={(e) => handleProGatedTypeClick(e, {
                      isPro: isPro,
                      count: t.count,
                      typeName: t.name,
                      showUpgradePrompt: openPrompt,
                    })}
                    className={cn(
                      'group flex size-11 items-center justify-center rounded-lg transition-colors',
                      isCurrentPage
                        ? 'bg-foreground/10 text-foreground'
                        : 'hover:bg-foreground/5'
                    )}
                  >
                    <ItemTypeIcon iconName={t.icon} color={t.color} className="size-4 shrink-0" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">{getTypeLabel(t.name)}</TooltipContent>
              </Tooltip>
              )
            })}

            {favoriteCollections.length > 0 && (
              <>
                <Separator className="my-1 w-8" />
                {favoriteCollections.map((c) => (
                  <Tooltip key={c.id}>
                    <TooltipTrigger render={<span />}>
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
              <TooltipTrigger render={
                <DropdownMenuTrigger render={
                  <Button variant="ghost" size="icon" className="text-muted-foreground" />
                } />
              }>
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
