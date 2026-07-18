import type { ReactElement } from 'react'
import type { HTMLProps } from '@base-ui/react/types'
import { Link } from '@tanstack/react-router'
import { Archive, PanelRight, Settings, Sparkles, Star } from 'lucide-react'
import { toast } from 'sonner'
import { ITEM_TYPES } from '@/lib/item-types'
import { cn } from '@/lib/utils'
import { useCollections } from '@/hooks/use-collections'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { UserDropdownMenuContent } from './user-dropdown'

// Every TooltipTrigger here wraps its Link/Button in a plain, non-interactive <span> so the
// Link/Button itself stays the real interactive element. Module-level function references (not
// inline arrows) are created once ever, satisfying Base UI's composition guidance.
// These are Base UI `render` callbacks, which must return a ReactElement (not a ReactNode).
function renderSpanTrigger(props: HTMLProps): ReactElement {
  return <span {...props} />
}

function renderDropdownTriggerButton(props: HTMLProps): ReactElement {
  return <Button {...props} variant="ghost" size="icon-sm" className="text-muted-foreground" />
}

// Composes the two renders above so the settings tooltip's trigger element is the
// DropdownMenuTrigger, which itself renders as the Button.
function renderSettingsTooltipTrigger(props: HTMLProps): ReactElement {
  return <DropdownMenuTrigger {...props} render={renderDropdownTriggerButton} />
}

const railLinkClass =
  'flex size-11 items-center justify-center rounded-lg transition-colors hover:bg-foreground/5'
const railActiveProps = { className: 'bg-foreground/10 text-foreground' }

interface CollapsedSidebarProps {
  onToggle: () => void
}

/**
 * The collapsed sidebar rail: icon-only links with tooltips, mirroring the expanded sidebar's
 * sections (Brain Dump, item types, favorite collections, user menu) in the same order.
 */
export function CollapsedSidebar({ onToggle }: CollapsedSidebarProps): ReactElement {
  const { data: collections } = useCollections()
  const favorites = (collections ?? []).filter((c) => c.isFavorite)

  return (
    <TooltipProvider delay={300}>
      <div className="flex h-full flex-col items-center overflow-hidden py-2">
        <Tooltip>
          <TooltipTrigger render={renderSpanTrigger}>
            <Link to="/dashboard" aria-label="DevStash home" className={railLinkClass}>
              <Archive className="size-5 shrink-0 text-blue-400" aria-hidden="true" />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right">Dashboard</TooltipContent>
        </Tooltip>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggle}
          aria-label="Expand sidebar"
          className="mb-2 mt-1 text-muted-foreground"
        >
          <PanelRight className="size-4" />
        </Button>

        <Separator className="mb-2 w-8" />

        <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto px-2">
          <Tooltip>
            <TooltipTrigger render={renderSpanTrigger}>
              <button
                type="button"
                onClick={() => {
                  toast('Brain Dump is coming soon.')
                }}
                className={railLinkClass}
              >
                <Sparkles className="size-4 shrink-0 text-primary" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Brain Dump</TooltipContent>
          </Tooltip>

          <Separator className="my-1 w-8" />

          {ITEM_TYPES.map((type) => {
            const Icon = type.icon
            return (
              <Tooltip key={type.name}>
                <TooltipTrigger render={renderSpanTrigger}>
                  <Link
                    to="/items/$type"
                    params={{ type: type.name }}
                    activeProps={railActiveProps}
                    className={railLinkClass}
                  >
                    <Icon className={cn('size-4 shrink-0', type.accent)} />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">{type.plural}</TooltipContent>
              </Tooltip>
            )
          })}

          {favorites.length > 0 && (
            <>
              <Separator className="my-1 w-8" />
              {favorites.map((c) => (
                <Tooltip key={c.id}>
                  <TooltipTrigger render={renderSpanTrigger}>
                    <Link
                      to="/collections/$id"
                      params={{ id: c.id }}
                      activeProps={railActiveProps}
                      className={railLinkClass}
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
