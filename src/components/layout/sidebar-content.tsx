'use client' // required: collapsible sections and sidebar toggle use useState

import { useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Star,
  Settings,
  ChevronDown,
  PanelLeft,
  PanelRight,
  LogOut,
  User,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn, getTypeLabel } from '@/lib/utils'
import { ItemTypeIcon } from '@/components/shared/item-type-icon'
import { Badge } from '@/components/ui/badge'
import { UserAvatar } from '@/components/shared/user-avatar'
import { signOutAction } from '@/actions/auth/login'
import { PRO_ITEM_TYPE_NAMES } from '@/lib/utils/constants'
import type { SidebarData } from '@/types/sidebar'

function getTypeHref(name: string) {
  return `/items/${name}s`
}

interface CollapsedSidebarProps {
  sidebarData: SidebarData
  onToggle: () => void
}

function CollapsedSidebar({ sidebarData, onToggle }: CollapsedSidebarProps) {
  const favoriteCollections = sidebarData.collections.filter((c) => c.isFavorite)

  return (
    <TooltipProvider delay={300}>
      <div className="flex h-full flex-col items-center py-2 overflow-hidden">
        <Button variant="ghost" size="icon" onClick={onToggle} className="mb-2 text-muted-foreground">
          <PanelRight className="size-4" />
        </Button>

        <Separator className="mb-2 w-8" />

        <ScrollArea className="flex-1 min-h-0 w-full">
          <div className="flex flex-col items-center gap-1 px-2">
            {sidebarData.itemTypes.map((t) => (
              <Tooltip key={t.id}>
                <TooltipTrigger render={<span />}>
                  <Link
                    href={getTypeHref(t.name)}
                    className="flex size-11 items-center justify-center rounded-lg transition-colors hover:bg-muted"
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
                        className="flex size-11 items-center justify-center rounded-lg transition-colors hover:bg-muted"
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
          <Tooltip>
            <TooltipTrigger render={<span />}>
              <Button render={<Link href="/settings" />} nativeButton={false} variant="ghost" size="icon" className="text-muted-foreground">
                <Settings className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Settings</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  )
}

interface ExpandedSidebarProps {
  sidebarData: SidebarData
  onClose?: () => void
  onToggle?: () => void
}

function ExpandedSidebar({ sidebarData, onClose, onToggle }: ExpandedSidebarProps) {
  const router = useRouter()
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

      <ScrollArea className="flex-1 min-h-0 py-3">
        <Collapsible open={typesOpen} onOpenChange={setTypesOpen}>
          <CollapsibleTrigger className="flex w-full items-center justify-between rounded-none px-4 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:bg-transparent hover:text-foreground">
            Types
            <ChevronDown className={cn('size-3 transition-transform duration-150', !typesOpen && '-rotate-90')} />
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-0.5 px-2">
            {sidebarData.itemTypes.map((t) => (
              <Link
                key={t.id}
                href={getTypeHref(t.name)}
                onClick={onClose}
                className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <ItemTypeIcon iconName={t.icon} color={t.color} className="size-4 shrink-0" />
                <span className="flex-1">{getTypeLabel(t.name)}</span>
                {PRO_ITEM_TYPE_NAMES.has(t.name) && (
                  <Badge variant="outline" className="h-4 px-1 text-[10px] font-semibold text-muted-foreground/60">PRO</Badge>
                )}
                <span className="text-xs tabular-nums">{t.count}</span>
              </Link>
            ))}
          </CollapsibleContent>
        </Collapsible>

        <Separator className="my-3 mx-4 w-auto" />

        <Collapsible open={collectionsOpen} onOpenChange={setCollectionsOpen}>
          <CollapsibleTrigger className="flex w-full items-center justify-between rounded-none px-4 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:bg-transparent hover:text-foreground">
            Collections
            <ChevronDown className={cn('size-3 transition-transform duration-150', !collectionsOpen && '-rotate-90')} />
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
                      className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-400" />
                      <span className="flex-1 truncate">{c.name}</span>
                      <span className="text-xs tabular-nums">{c.itemCount}</span>
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
                      className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <span
                        className="size-2 shrink-0 rounded-full bg-[var(--item-color)]"
                        style={{ '--item-color': c.dominantColor ?? '#6b7280' } as CSSProperties}
                      />
                      <span className="flex-1 truncate">{c.name}</span>
                      <span className="text-xs tabular-nums">{c.itemCount}</span>
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
          <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left transition-colors hover:bg-muted focus:outline-none">
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
          <DropdownMenuContent side="top" align="start" className="w-52">
            <DropdownMenuItem onClick={() => router.push('/profile')}>
              <User className="size-4" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push('/settings')}>
              <Settings className="size-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => signOutAction()} className="text-red-500 focus:text-red-500">
              <LogOut className="size-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

interface SidebarContentProps {
  sidebarData: SidebarData
  onClose?: () => void
  collapsible?: boolean
}

export function SidebarContent({ sidebarData, onClose, collapsible = false }: SidebarContentProps) {
  const [collapsed, setCollapsed] = useState(false)

  if (collapsible) {
    return (
      <aside
        className={`hidden flex-col border-r border-border bg-muted/30 transition-all duration-200 lg:flex ${collapsed ? 'w-14' : 'w-56'} overflow-hidden`}
      >
        {collapsed ? (
          <CollapsedSidebar sidebarData={sidebarData} onToggle={() => setCollapsed(false)} />
        ) : (
          <ExpandedSidebar sidebarData={sidebarData} onToggle={() => setCollapsed(true)} />
        )}
      </aside>
    )
  }

  return <ExpandedSidebar sidebarData={sidebarData} onClose={onClose} />
}
