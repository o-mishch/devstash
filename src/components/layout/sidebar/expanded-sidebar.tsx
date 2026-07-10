'use client'

import { memo, useCallback, useMemo, useState, type CSSProperties, type MouseEvent } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  Star,
  Settings,
  ChevronDown,
  PanelLeft,
  Home,
  Archive,
  Sparkles,
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
import type { SidebarItemType } from '@/types/item'
import type { CollectionWithTypes } from '@/types/collection'
import type { UserProfileFlagsResponse } from '@/lib/api/schemas/profile'
import { useUpgradePromptStore } from '@/stores/upgrade-prompt'
import { useUserProfile, useIsPro } from '@/hooks/profile/use-user-profile'
import { useCollections } from '@/hooks/items/use-collections'
import { UserDropdownMenuContent } from './user-dropdown'
import { getTypeHref, sidebarLinkClass, handleProGatedTypeClick, handleBrainDumpClick } from './utils'

interface ExpandedSidebarProps {
  sidebarData: SidebarData
  onClose?: () => void
  onToggle?: () => void
}

// Stable fallback so `profile ?? EMPTY_PROFILE_NAME_FIELDS` never allocates a new object per render
// while `profile` is still loading — module-level, created once ever (not per render/useMemo).
const EMPTY_PROFILE_NAME_FIELDS: Pick<UserProfileFlagsResponse, 'name' | 'email' | 'image'> = {
  name: null,
  email: null,
  image: null,
}

interface SidebarTypeLinkProps {
  type: SidebarItemType
  pathname: string
  isPro: boolean
  onUpgrade: (opts: { title: string; description: string }) => void
  onClose?: () => void
}

// One per-item link extracted out of the `itemTypes.map()` loop so the click handler is created once
// per row's own render (scoped to its own props) instead of a new closure on every parent re-render.
const SidebarTypeLink = memo(function SidebarTypeLink({
  type: t,
  pathname,
  isPro,
  onUpgrade,
  onClose,
}: SidebarTypeLinkProps) {
  const typeHref = getTypeHref(t.name)
  const isCurrentPage = pathname === typeHref
  const isProGated = PRO_ITEM_TYPE_NAMES.has(t.name)

  const handleClick = useCallback(
    (e: MouseEvent<HTMLAnchorElement>) => {
      const blocked = handleProGatedTypeClick(e, { isPro, typeName: t.name, showUpgradePrompt: onUpgrade })
      if (!blocked) onClose?.()
    },
    [isPro, t.name, onUpgrade, onClose],
  )

  return (
    <Link
      href={typeHref}
      // Eager-prefetch the route's RSC payload so navigation is instant; skip
      // Pro-gated routes for non-Pro users (they can't open them anyway).
      prefetch={!isProGated || isPro}
      onClick={handleClick}
      className={sidebarLinkClass(isCurrentPage)}
    >
      <ItemTypeIcon iconName={t.icon} color={t.color} className="size-4 shrink-0" />
      {isProGated && (
        <Badge variant="outline" className="h-4 px-1 text-[10px] font-semibold text-muted-foreground/60 mr-1.5">PRO</Badge>
      )}
      <span className="flex-1">{getTypeLabel(t.name)}</span>
      <span className="text-xs tabular-nums pr-2">{t.count}</span>
    </Link>
  )
})

interface RecentCollectionLinkProps {
  collection: CollectionWithTypes
  pathname: string
  onClose?: () => void
}

// One per-item link extracted out of the `recentCollections.map()` loop so the `--item-color` style
// object is memoized against its own `dominantColor` instead of being a fresh object literal created
// once per row on every parent re-render.
const RecentCollectionLink = memo(function RecentCollectionLink({
  collection: c,
  pathname,
  onClose,
}: RecentCollectionLinkProps) {
  const href = `/collections/${c.id}`
  const dotStyle = useMemo(
    () => ({ '--item-color': c.dominantColor ?? '#6b7280' }) as CSSProperties,
    [c.dominantColor],
  )

  return (
    <Link href={href} prefetch={true} onClick={onClose} className={sidebarLinkClass(pathname === href)}>
      <span className="size-2 shrink-0 rounded-full bg-[var(--item-color)]" style={dotStyle} />
      <span className="flex-1 truncate">{c.name}</span>
      <span className="text-xs tabular-nums pr-2">{c.itemCount}</span>
    </Link>
  )
})

export function ExpandedSidebar({ sidebarData, onClose, onToggle }: ExpandedSidebarProps) {
  const pathname = usePathname()
  const { openPrompt } = useUpgradePromptStore()
  const [typesOpen, setTypesOpen] = useState(true)
  const [collectionsOpen, setCollectionsOpen] = useState(true)

  const { data: profile } = useUserProfile()
  const { name, email, image } = profile ?? EMPTY_PROFILE_NAME_FIELDS
  const isPro = useIsPro()
  const { collections } = useCollections({ initialData: sidebarData.collections })

  const favoriteCollections = collections.filter((c) => c.isFavorite)
  const recentCollections = collections.filter((c) => !c.isFavorite).slice(0, 5)

  const handleBrainDumpLinkClick = useCallback(
    (e: MouseEvent<HTMLAnchorElement>) => {
      const blocked = handleBrainDumpClick(e, { isPro, showUpgradePrompt: openPrompt })
      if (!blocked) onClose?.()
    },
    [isPro, openPrompt, onClose],
  )

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {onToggle && (
        <>
          <div className="flex h-14 shrink-0 items-center px-3">
            <Button variant="ghost" size="icon" onClick={onToggle} className="group text-muted-foreground">
              <PanelLeft className="size-4 card-icon" />
            </Button>
          </div>
          <Separator />
        </>
      )}

      <ScrollArea className="flex-1 min-h-0 py-3 [&_[data-slot=scroll-area-viewport]]:!overflow-x-hidden">
        {/* Brain Dump entry — visible on desktop sidebar + mobile drawer */}
        <div className="space-y-0.5 px-2 pb-1">
          <Link
            href="/parse"
            // Non-Pro users can't open Brain Dump — block the nav and show the Pro gate instead,
            // matching the file/image type links; skip prefetch for them (they can't open it anyway).
            prefetch={isPro}
            onClick={handleBrainDumpLinkClick}
            className={sidebarLinkClass(pathname === '/parse' || pathname.startsWith('/parse/'))}
          >
            <Sparkles className="size-4 shrink-0 card-icon" />
            <Badge variant="outline" className="h-4 px-1 text-[10px] font-semibold text-muted-foreground/60 mr-1.5">PRO</Badge>
            <span>Brain Dump</span>
          </Link>
        </div>
        <Separator className="my-2 mx-4 w-auto" />
        {/* Mobile-only: home navigation at the top of the drawer */}
        {onClose && !onToggle && (
          <>
            <div className="space-y-0.5 px-2 pb-1">
              <Link
                href="/dashboard"
                onClick={onClose}
                prefetch={true}
                className={sidebarLinkClass(pathname === '/dashboard')}
              >
                <Home className="size-4 shrink-0 card-icon" />
                <span>Home</span>
              </Link>
              <Link
                href="/collections"
                onClick={onClose}
                prefetch={true}
                className={sidebarLinkClass(pathname === '/collections')}
              >
                <Archive className="size-4 shrink-0 card-icon" />
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
              <SidebarTypeLink
                key={t.id}
                type={t}
                pathname={pathname}
                isPro={isPro}
                onUpgrade={openPrompt}
                onClose={onClose}
              />
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
                      prefetch={true}
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
                    <RecentCollectionLink key={c.id} collection={c} pathname={pathname} onClose={onClose} />
                  ))}
                </div>
              </>
            )}

            <div className="mt-2 px-4">
              <Link
                href="/collections"
                onClick={onClose}
                prefetch={true}
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
          <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left transition-colors hover:bg-foreground/5 focus:outline-none">
            <UserAvatar
              name={name}
              image={image}
              className="shrink-0"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium leading-none">
                {name ?? 'Guest'}
              </p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {email ?? ''}
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
