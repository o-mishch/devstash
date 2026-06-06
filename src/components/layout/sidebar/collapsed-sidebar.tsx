'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { PanelRight, Star, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn, getTypeLabel } from '@/lib/utils'
import { ItemTypeIcon } from '@/components/shared/item-type-icon'
import type { SidebarData } from '@/types/sidebar'
import { useUpgradePrompt } from '@/context/upgrade-prompt-context'
import { UserDropdownMenuContent } from './user-dropdown'
import { getTypeHref, handleProGatedTypeClick } from './utils'

interface CollapsedSidebarProps {
  sidebarData: SidebarData
  onToggle: () => void
}

export function CollapsedSidebar({ sidebarData, onToggle }: CollapsedSidebarProps) {
  const pathname = usePathname()
  const { showUpgradePrompt } = useUpgradePrompt()
  const favoriteCollections = sidebarData.collections.filter((c) => c.isFavorite)

  return (
    <TooltipProvider delay={300}>
      <div className="flex h-full flex-col items-center py-2 overflow-hidden">
        <Button variant="ghost" size="icon" onClick={onToggle} className="mb-2 text-muted-foreground">
          <PanelRight className="size-4" />
        </Button>

        <Separator className="mb-2 w-8" />

        <ScrollArea className="flex-1 min-h-0 w-full [&_[data-slot=scroll-area-viewport]]:!overflow-x-hidden">
          <div className="flex flex-col items-center gap-1 px-2">
            {sidebarData.itemTypes.map((t) => (
              <Tooltip key={t.id}>
                <TooltipTrigger render={<span />}>
                  <Link
                    href={getTypeHref(t.name)}
                    onClick={(e) => handleProGatedTypeClick(e, {
                      isPro: sidebarData.user?.isPro ?? false,
                      count: t.count,
                      typeName: t.name,
                      showUpgradePrompt,
                    })}
                    className={cn(
                      'flex size-11 items-center justify-center rounded-lg transition-colors',
                      pathname === getTypeHref(t.name)
                        ? 'bg-foreground/10 text-foreground'
                        : 'hover:bg-foreground/5'
                    )}
                  >
                    <ItemTypeIcon iconName={t.icon} color={t.color} className="size-4 shrink-0" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">{getTypeLabel(t.name)}</TooltipContent>
              </Tooltip>
            ))}

            {favoriteCollections.length > 0 && (
              <>
                <Separator className="my-1 w-8" />
                {favoriteCollections.map((c) => (
                  <Tooltip key={c.id}>
                    <TooltipTrigger render={<span />}>
                      <Link
                        href={`/collections/${c.id}`}
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
