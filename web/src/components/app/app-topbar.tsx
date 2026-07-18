import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Menu, Star, Zap } from 'lucide-react'
import { useSession } from '@/auth/session'
import { useUIStore } from '@/stores/ui'
import { Button } from '@/components/ui/button'
import { CreateCollectionDialog } from '@/components/collections/create-collection-dialog'
import { CreateItemDialog } from '@/components/items/create-item-dialog'
import { GlobalSearch } from './global-search'

/** Sticky top bar: mobile menu, ⌘K search, Upgrade (non-Pro), Favorites, and create actions. */
export function AppTopbar(): ReactNode {
  const { data: session } = useSession()
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const isPro = session?.user.isPro === true

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur lg:px-8">
      <button
        type="button"
        aria-label="Open menu"
        onClick={toggleSidebar}
        className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground lg:hidden"
      >
        <Menu className="size-5" />
      </button>

      <div className="flex flex-1 justify-center">
        <GlobalSearch />
      </div>

      <div className="flex items-center gap-2">
        {!isPro && (
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link to="/settings" />}
            className="hidden text-muted-foreground sm:inline-flex"
          >
            <Zap className="size-4" />
            Upgrade
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Favorites"
          title="Favorites"
          nativeButton={false}
          render={<Link to="/favorites" />}
        >
          <Star className="size-4" />
        </Button>
        <span className="hidden sm:inline-flex">
          <CreateCollectionDialog />
        </span>
        <CreateItemDialog />
      </div>
    </header>
  )
}
