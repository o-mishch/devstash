'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  Code,
  Sparkles,
  Terminal,
  StickyNote,
  File,
  Image as ImageIcon,
  Link as LinkIcon,
  Star,
  Settings,
  ChevronDown,
  PanelLeft,
  PanelRight,
} from 'lucide-react'
import { mockUser, mockCollections, mockItemTypeCounts } from '@/lib/mock-data'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const ITEM_TYPES = [
  { name: 'snippet' as const, label: 'Snippets', Icon: Code, color: '#3b82f6', href: '/items/snippets' },
  { name: 'prompt' as const, label: 'Prompts', Icon: Sparkles, color: '#8b5cf6', href: '/items/prompts' },
  { name: 'command' as const, label: 'Commands', Icon: Terminal, color: '#f97316', href: '/items/commands' },
  { name: 'note' as const, label: 'Notes', Icon: StickyNote, color: '#fde047', href: '/items/notes' },
  { name: 'file' as const, label: 'Files', Icon: File, color: '#6b7280', href: '/items/files' },
  { name: 'image' as const, label: 'Images', Icon: ImageIcon, color: '#ec4899', href: '/items/images' },
  { name: 'link' as const, label: 'Links', Icon: LinkIcon, color: '#10b981', href: '/items/links' },
]

interface CollapsedSidebarProps {
  onToggle: () => void
}

function CollapsedSidebar({ onToggle }: CollapsedSidebarProps) {
  const favoriteCollections = mockCollections.filter((c) => c.isFavorite)

  return (
    <TooltipProvider delay={300}>
      <div className="flex h-full flex-col items-center py-2">
        <Button variant="ghost" size="icon" onClick={onToggle} className="mb-2 text-muted-foreground">
          <PanelRight className="size-4" />
        </Button>

        <Separator className="mb-2 w-8" />

        <ScrollArea className="flex-1 w-full">
          <div className="flex flex-col items-center gap-1 px-2">
            {ITEM_TYPES.map(({ name, label, Icon, color, href }) => (
              <Tooltip key={name}>
                <TooltipTrigger render={<span />}>
                  <Link
                    href={href}
                    className="flex size-9 items-center justify-center rounded-lg transition-colors hover:bg-muted"
                  >
                    <Icon className="size-4 shrink-0" style={{ color }} />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">{label}</TooltipContent>
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
  onClose?: () => void
  onToggle?: () => void
}

function ExpandedSidebar({ onClose, onToggle }: ExpandedSidebarProps) {
  const [typesOpen, setTypesOpen] = useState(true)
  const [collectionsOpen, setCollectionsOpen] = useState(true)

  const favoriteCollections = mockCollections.filter((c) => c.isFavorite)
  const recentCollections = mockCollections
    .filter((c) => !c.isFavorite)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())

  const initials = mockUser.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()

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
            {ITEM_TYPES.map(({ name, label, Icon, color, href }) => (
              <Link
                key={name}
                href={href}
                onClick={onClose}
                className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Icon className="size-4 shrink-0" style={{ color }} />
                <span className="flex-1">{label}</span>
                <span className="text-xs tabular-nums">{mockItemTypeCounts[name]}</span>
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
                <Label className="px-4 pb-0.5 text-xs uppercase tracking-wider text-muted-foreground/60">
                  Favorites
                </Label>
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
                    </Link>
                  ))}
                </div>
              </>
            )}

            <Label className="px-4 pb-0.5 text-xs uppercase tracking-wider text-muted-foreground/60">
              Recent
            </Label>
            <div className="space-y-0.5 px-2 pl-4">
              {recentCollections.map((c) => (
                <Link
                  key={c.id}
                  href={`/collections/${c.id}`}
                  onClick={onClose}
                  className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <span className="flex-1 truncate">{c.name}</span>
                  <span className="text-xs tabular-nums">{c.itemCount}</span>
                </Link>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </ScrollArea>

      <Separator />
      <div className="shrink-0 p-3">
        <div className="flex items-center gap-2">
          <Avatar className="size-8 shrink-0">
            <AvatarFallback className="bg-primary text-primary-foreground text-xs font-medium">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium leading-none">{mockUser.name}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{mockUser.email}</p>
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
  onClose?: () => void
  onToggle?: () => void
  collapsed?: boolean
}

export function SidebarContent({ onClose, onToggle, collapsed = false }: SidebarContentProps) {
  if (collapsed && onToggle) {
    return <CollapsedSidebar onToggle={onToggle} />
  }
  return <ExpandedSidebar onClose={onClose} onToggle={onToggle} />
}
