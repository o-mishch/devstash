'use client'

import { useState, type CSSProperties } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  Star,
  Settings,
  ChevronDown,
  PanelLeft,
  Home,
  Archive,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn, getTypeLabel } from '@/lib/utils'
import { ItemTypeIcon } from '@/components/shared/item-type-icon'
import { Badge } from '@/components/ui/badge'
import { UserAvatar } from '@/components/shared/user-avatar'
import { PRO_ITEM_TYPE_NAMES } from '@/lib/utils/constants'
import type { SidebarData } from '@/types/sidebar'
import { useUpgradePrompt } from '@/context/upgrade-prompt-context'
import { UserDropdownMenuContent } from './user-dropdown'
import { getTypeHref, sidebarLinkClass, handleProGatedTypeClick } from './utils'

interface ExpandedSidebarProps {
  sidebarData: SidebarData
  onClose?: () => void
  onToggle?: () => void
}

export function ExpandedSidebar({ sidebarData, onClose, onToggle }: ExpandedSidebarProps) {
  const pathname = usePathname()
  const { showUpgradePrompt } = useUpgradePrompt()
  const [typesOpen, setTypesOpen] = useState(true)
  const [collectionsOpen, setCollectionsOpen] = useState(true)

  const favoriteCollections = sidebarData.collections.filter((c) => c.isFavorite)
  const recentCollections = sidebarData.collections.filter((c) => !c.isFavorite).slice(0, 5)

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {onToggle && (
        <>
          <div className="flex h-14 shrink-0 items-center px-3">
            <Button variant="ghost" size="icon" onClick={onToggle} className="text-muted-foreground">
              <PanelLeft className="size-4" />
            </Button>
          </div>
          <Separator />
        </>
      )}

      <ScrollArea className="flex-1 min-h-0 py-3 [&_[data-slot=scroll-area-viewport]]:!overflow-x-hidden">
        {/* Mobile-only: home navigation at the top of the drawer */}
        {onClose && !onToggle && (
          <>
            <div className="space-y-0.5 px-2 pb-1">
              <Link
                href="/dashboard"
                onClick={onClose}
                className={sidebarLinkClass(pathname === '/dashboard')}
              >
                <Home className="size-4 shrink-0" />
                <span>Home</span>
              </Link>
              <Link
                href="/collections"
                onClick={onClose}
                className={sidebarLinkClass(pathname === '/collections')}
              >
                <Archive className="size-4 shrink-0" />
                <span>All Collections</span>
              </Link>
            </div>
            <Separator className="my-2 mx-4 w-auto" />
          </>
        )}
        <Collapsible open={typesOpen} onOpenChange={setTypesOpen}>
          <CollapsibleTrigger className="flex w-full items-center justify-between rounded-none px-4 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:bg-transparent hover:text-foreground">
            Types
            <ChevronDown className={cn('size-3 transition-transform duration-300 ease-in-out', !typesOpen && '-rotate-90')} />
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-0.5 px-2">
            {sidebarData.itemTypes.map((t) => (
              <Link
                key={t.id}
                href={getTypeHref(t.name)}
                onClick={(e) => {
                  const blocked = handleProGatedTypeClick(e, {
                    isPro: sidebarData.user?.isPro ?? false,
                    count: t.count,
                    typeName: t.name,
                    showUpgradePrompt,
                  })
                  if (!blocked) onClose?.()
                }}
                className={sidebarLinkClass(pathname === getTypeHref(t.name))}
              >
                <ItemTypeIcon iconName={t.icon} color={t.color} className="size-4 shrink-0" />
                {PRO_ITEM_TYPE_NAMES.has(t.name) && (
                  <Badge variant="outline" className="h-4 px-1 text-[10px] font-semibold text-muted-foreground/60 mr-1.5">PRO</Badge>
                )}
                <span className="flex-1">{getTypeLabel(t.name)}</span>
                <span className="text-xs tabular-nums pr-2">{t.count}</span>
              </Link>
            ))}
          </CollapsibleContent>
        </Collapsible>

        <Separator className="my-3 mx-4 w-auto" />

        <Collapsible open={collectionsOpen} onOpenChange={setCollectionsOpen}>
          <CollapsibleTrigger className="flex w-full items-center justify-between rounded-none px-4 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:bg-transparent hover:text-foreground">
            Collections
            <ChevronDown className={cn('size-3 transition-transform duration-300 ease-in-out', !collectionsOpen && '-rotate-90')} />
          </CollapsibleTrigger>
          <CollapsibleContent>
            {favoriteCollections.length > 0 && (
              <>
                <p className="px-4 pb-0.5 text-xs text-muted-foreground/60">
                  Favorites
                </p>
                <div className="mb-3 space-y-0.5 px-2">
                  {favoriteCollections.map((c) => (
                    <Link
                      key={c.id}
                      href={`/collections/${c.id}`}
                      onClick={onClose}
                      className={sidebarLinkClass(pathname === `/collections/${c.id}`)}
                    >
                      <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-400" />
                      <span className="flex-1 truncate">{c.name}</span>
                      <span className="text-xs tabular-nums pr-2">{c.itemCount}</span>
                    </Link>
                  ))}
                </div>
              </>
            )}

            {recentCollections.length > 0 && (
              <>
                <p className="px-4 pb-0.5 text-xs text-muted-foreground/60">
                  Recent
                </p>
                <div className="space-y-0.5 px-2">
                  {recentCollections.map((c) => (
                    <Link
                      key={c.id}
                      href={`/collections/${c.id}`}
                      onClick={onClose}
                      className={sidebarLinkClass(pathname === `/collections/${c.id}`)}
                    >
                      <span
                        className="size-2 shrink-0 rounded-full bg-[var(--item-color)]"
                        style={{ '--item-color': c.dominantColor ?? '#6b7280' } as CSSProperties}
                      />
                      <span className="flex-1 truncate">{c.name}</span>
                      <span className="text-xs tabular-nums pr-2">{c.itemCount}</span>
                    </Link>
                  ))}
                </div>
              </>
            )}

            <div className="mt-2 px-4">
              <Link
                href="/collections"
                onClick={onClose}
                className="text-xs text-muted-foreground/60 transition-colors hover:text-muted-foreground"
              >
                View all collections →
              </Link>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </ScrollArea>

      <Separator />
      <div className="shrink-0 p-3">
        <DropdownMenu>
          <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left transition-colors hover:bg-foreground/5 focus:outline-none cursor-pointer">
            <UserAvatar
              name={sidebarData.user?.name}
              image={sidebarData.user?.image}
              className="shrink-0"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium leading-none">
                {sidebarData.user?.name ?? 'Guest'}
              </p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {sidebarData.user?.email ?? ''}
              </p>
            </div>
            <Settings className="size-3.5 shrink-0 text-muted-foreground" />
          </DropdownMenuTrigger>
              <UserDropdownMenuContent side="top" align="start" onClose={onClose} />
        </DropdownMenu>
      </div>
    </div>
  )
}
