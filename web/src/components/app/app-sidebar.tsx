import type { CSSProperties, ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Archive, ChevronDown, PanelLeft, Settings, Sparkles, Star } from 'lucide-react'
import { toast } from 'sonner'
import { ITEM_TYPES } from '@/lib/item-types'
import { cn, hasText } from '@/lib/utils'
import { useUIStore } from '@/stores/ui'
import { useSession } from '@/auth/session'
import { useCollections } from '@/hooks/use-collections'
import { useStats, itemTypeCount } from '@/hooks/use-stats'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { UserDropdownMenuContent } from './user-dropdown'

const linkClass =
  'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
const activeProps = { className: 'bg-accent text-foreground' }
const sectionHeaderClass =
  'flex w-full items-center justify-between px-2 py-1 font-mono text-[0.65rem] uppercase tracking-widest text-muted-foreground/60 transition-colors hover:text-muted-foreground'

interface AppSidebarProps {
  /** Collapses the rail. Omitted on mobile, where the sidebar is a drawer rather than a rail. */
  onToggle?: () => void
}

/** Left navigation: brand, Brain Dump, item TYPES with counts, COLLECTIONS, and a user card. */
export function AppSidebar({ onToggle }: AppSidebarProps): ReactNode {
  const close = useUIStore((s) => s.setSidebarOpen)
  const onNavigate = (): void => close(false)

  return (
    <nav className="flex h-full flex-col gap-4 overflow-y-auto bg-sidebar p-3">
      <div className="flex items-center justify-between gap-1">
        <Link
          to="/dashboard"
          onClick={onNavigate}
          className="flex min-w-0 items-center gap-2 px-2 py-1"
          aria-label="DevStash home"
        >
          <Archive className="size-5 shrink-0 text-blue-400" aria-hidden="true" />
          <span className="truncate bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-lg font-bold tracking-tight text-transparent">
            DevStash
          </span>
        </Link>
        {onToggle !== undefined && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggle}
            aria-label="Collapse sidebar"
            className="shrink-0 text-muted-foreground"
          >
            <PanelLeft className="size-4" />
          </Button>
        )}
      </div>

      <BrainDumpLink />

      <div className="flex flex-1 flex-col gap-4">
        <TypesSection onNavigate={onNavigate} />
        <CollectionsSection onNavigate={onNavigate} />
      </div>

      <UserCard />
    </nav>
  )
}

/**
 * Brain Dump is a Pro AI feature (legacy `/parse`). Its backend is Backend Phase 6 (not yet
 * migrated), so this renders the entry for visual parity but announces it's not live rather
 * than navigating to a route that doesn't exist. Replace the onClick with a real link once the
 * AI surface ships.
 */
function BrainDumpLink(): ReactNode {
  return (
    <button
      type="button"
      onClick={() => {
        toast('Brain Dump is coming soon.')
      }}
      className={cn(linkClass, 'w-full')}
    >
      <Sparkles className="size-4 text-primary" />
      <span className="flex-1 text-left">Brain Dump</span>
      <ProBadge />
    </button>
  )
}

function ProBadge(): ReactNode {
  return (
    <Badge
      variant="outline"
      className="border-primary/30 px-1.5 py-0 font-mono text-[0.6rem] tracking-widest text-primary"
    >
      PRO
    </Badge>
  )
}

interface NavSectionProps {
  onNavigate: () => void
}

function TypesSection({ onNavigate }: NavSectionProps): ReactNode {
  const { data: stats } = useStats()

  return (
    <Collapsible defaultOpen className="flex flex-col gap-0.5">
      <CollapsibleTrigger className={cn(sectionHeaderClass, 'group')}>
        Types
        <ChevronDown className="size-3.5 transition-transform group-data-[panel-open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-0.5">
        {ITEM_TYPES.map((type): ReactNode => {
          const Icon = type.icon
          const count = itemTypeCount(stats, type.name)
          return (
            <Link
              key={type.name}
              to="/items/$type"
              params={{ type: type.name }}
              onClick={onNavigate}
              activeProps={activeProps}
              className={linkClass}
            >
              <Icon className={cn('size-4', type.accent)} />
              <span className="flex-1">{type.plural}</span>
              {'pro' in type && <ProBadge />}
              <span className="font-mono text-xs tabular-nums text-muted-foreground/70">
                {count}
              </span>
            </Link>
          )
        })}
      </CollapsibleContent>
    </Collapsible>
  )
}

function CollectionsSection({ onNavigate }: NavSectionProps): ReactNode {
  const { data: collections } = useCollections()
  const all = collections ?? []
  const favorites = all.filter((c) => c.isFavorite)
  const recent = all.filter((c) => !c.isFavorite).slice(0, 5)

  return (
    <Collapsible defaultOpen className="flex flex-col gap-0.5">
      <CollapsibleTrigger className={cn(sectionHeaderClass, 'group')}>
        Collections
        <ChevronDown className="size-3.5 transition-transform group-data-[panel-open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-1.5">
        {favorites.length > 0 && (
          <div className="flex flex-col gap-0.5">
            <p className="px-2 pt-1 text-[0.7rem] font-medium text-muted-foreground/50">
              Favorites
            </p>
            {favorites.map((c) => (
              <CollectionLink
                key={c.id}
                id={c.id}
                name={c.name}
                itemCount={c.itemCount}
                favorite
                onNavigate={onNavigate}
              />
            ))}
          </div>
        )}
        {recent.length > 0 && (
          <div className="flex flex-col gap-0.5">
            <p className="px-2 pt-1 text-[0.7rem] font-medium text-muted-foreground/50">Recent</p>
            {recent.map((c) => (
              <CollectionLink
                key={c.id}
                id={c.id}
                name={c.name}
                itemCount={c.itemCount}
                dominantColor={c.dominantColor}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        )}
        <Link
          to="/collections"
          onClick={onNavigate}
          className="px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          View all collections →
        </Link>
      </CollapsibleContent>
    </Collapsible>
  )
}

// Feeds the collection's DB-sourced dominant color in via a CSS var, consumed by an
// arbitrary-value Tailwind class (mirrors dashboard/stat-chip.tsx's statAccentStyle pattern).
function dotColorStyle(dominantColor: string | null | undefined): CSSProperties {
  return { '--dot-color': dominantColor ?? 'var(--muted-foreground)' }
}

interface CollectionLinkProps {
  id: string
  name: string
  itemCount: number
  favorite?: boolean
  dominantColor?: string | null
  onNavigate: () => void
}

function CollectionLink({
  id,
  name,
  itemCount,
  favorite,
  dominantColor,
  onNavigate,
}: CollectionLinkProps): ReactNode {
  return (
    <Link
      to="/collections/$id"
      params={{ id }}
      onClick={onNavigate}
      activeProps={activeProps}
      className={linkClass}
    >
      {favorite === true ? (
        <Star className="size-3.5 fill-amber-400 text-amber-400" />
      ) : (
        <span
          className="size-2.5 shrink-0 rounded-full bg-[var(--dot-color)]"
          // oxlint-disable-next-line react/forbid-dom-props -- dynamic CSS custom property (dominant color dot)
          style={dotColorStyle(dominantColor)}
        />
      )}
      <span className="flex-1 truncate">{name}</span>
      <span className="font-mono text-xs tabular-nums text-muted-foreground/70">{itemCount}</span>
    </Link>
  )
}

function UserCard(): ReactNode {
  const { data: session } = useSession()
  const user = session?.user
  if (!user) return null

  const displayName = hasText(user.name) ? user.name : user.email
  const initials = displayName.trim().slice(0, 2).toUpperCase()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2.5 rounded-lg border border-border/60 p-2 text-left transition-colors hover:bg-accent">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 font-mono text-xs font-medium text-primary">
          {initials}
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-sm font-medium text-foreground">{displayName}</span>
          <span className="truncate text-xs text-muted-foreground">{user.email}</span>
        </span>
        <Settings className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      {/* The card sits at the bottom of the rail, so the menu opens upward. */}
      <UserDropdownMenuContent side="top" align="end" />
    </DropdownMenu>
  )
}
