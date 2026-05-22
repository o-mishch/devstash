'use client' // required: collapsible sections and sidebar toggle use useState

import { useState } from 'react'
import Link from 'next/link'
import {
  Star,
  Settings,
  ChevronDown,
  PanelLeft,
  PanelRight,
} from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { getItemIcon } from '@/lib/icon-utils'
import { Badge } from '@/components/ui/badge'
import type { SidebarData } from './dashboard-layout'

const PRO_TYPE_NAMES = new Set(['file', 'image'])

function typeHref(name: string) {
  return `/items/${name}s`
}

function typeLabel(name: string) {
  return name.charAt(0).toUpperCase() + name.slice(1) + 's'
}

interface CollapsedSidebarProps {
  sidebarData: SidebarData
  onToggle: () => void
}

function CollapsedSidebar({ sidebarData, onToggle }: CollapsedSidebarProps) {
  const favoriteCollections = sidebarData.collections.filter((c) => c.isFavorite)

  return (
    <TooltipProvider delay={300}>
      <div className="flex h-full flex-col items-center py-2">
        <Button variant="ghost" size="icon" onClick={onToggle} className="mb-2 text-muted-foreground">
          <PanelRight className="size-4" />
        </Button>

        <Separator className="mb-2 w-8" />

        <ScrollArea className="flex-1 w-full">
          <div className="flex flex-col items-center gap-1 px-2">
            {sidebarData.itemTypes.map((t) => {
              const Icon = getItemIcon(t.icon)
              return (
                <Tooltip key={t.id}>
                  <TooltipTrigger render={<span />}>
                    <Link
                      href={typeHref(t.name)}
                      className="flex size-9 items-center justify-center rounded-lg transition-colors hover:bg-muted"
                    >
                      {Icon && <Icon className="size-4 shrink-0" style={{ color: t.color }} />}
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right">{typeLabel(t.name)}</TooltipContent>
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
                        className="flex size-9 items-center justify-center rounded-lg transition-colors hover:bg-muted"
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
              <Button variant="ghost" size="icon" className="text-muted-foreground">
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
  const [typesOpen, setTypesOpen] = useState(true)
  const [collectionsOpen, setCollectionsOpen] = useState(true)

  const favoriteCollections = sidebarData.collections.filter((c) => c.isFavorite)
  const recentCollections = sidebarData.collections.filter((c) => !c.isFavorite).slice(0, 5)

  return (
    <div className="flex h-full flex-col">
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

      <ScrollArea className="flex-1 py-3">
        <Collapsible open={typesOpen} onOpenChange={setTypesOpen}>
          <CollapsibleTrigger className="flex w-full items-center justify-between rounded-none px-4 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:bg-transparent hover:text-foreground">
            Types
            <ChevronDown className={cn('size-3 transition-transform duration-150', !typesOpen && '-rotate-90')} />
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-0.5 px-2">
            {sidebarData.itemTypes.map((t) => {
              const Icon = getItemIcon(t.icon)
              return (
                <Link
                  key={t.id}
                  href={typeHref(t.name)}
                  onClick={onClose}
                  className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {Icon && <Icon className="size-4 shrink-0" style={{ color: t.color }} />}
                  <span className="flex-1">{typeLabel(t.name)}</span>
                  {PRO_TYPE_NAMES.has(t.name) && (
                    <Badge variant="outline" className="h-4 px-1 text-[10px] font-semibold text-muted-foreground/60">PRO</Badge>
                  )}
                  <span className="text-xs tabular-nums">{t.count}</span>
                </Link>
              )
            })}
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
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: c.dominantColor ?? '#6b7280' }}
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
        <div className="flex items-center gap-2">
          <Avatar className="size-8 shrink-0">
            <AvatarFallback className="bg-primary text-primary-foreground text-xs font-medium">
              DS
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium leading-none">Demo User</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">demo@devstash.io</p>
          </div>
          <Button variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground">
            <Settings className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}

interface SidebarContentProps {
  sidebarData: SidebarData
  onClose?: () => void
  onToggle?: () => void
  collapsed?: boolean
}

export function SidebarContent({ sidebarData, onClose, onToggle, collapsed = false }: SidebarContentProps) {
  if (collapsed && onToggle) {
    return <CollapsedSidebar sidebarData={sidebarData} onToggle={onToggle} />
  }
  return <ExpandedSidebar sidebarData={sidebarData} onClose={onClose} onToggle={onToggle} />
}
