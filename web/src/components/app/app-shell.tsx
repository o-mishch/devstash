import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useSidebarCollapse } from '@/hooks/use-sidebar'
import { ItemDrawer } from '@/components/items/item-drawer'
import { AppSidebar } from './app-sidebar'
import { CollapsedSidebar } from './collapsed-sidebar'
import { MobileDrawer } from './mobile-drawer'
import { AppTopbar } from './app-topbar'
import { ThemeSync } from './theme-sync'

interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps): ReactNode {
  const { collapsed, setCollapsed } = useSidebarCollapse()

  return (
    // The document is the ONLY scroller, at every breakpoint — nothing in this shell may become a
    // scroll container. A mobile browser's URL bar collapses only in response to the root scroller,
    // and the item grid's window virtualizer measures against the window; an inner overflow box
    // would silently break both.
    <div className="min-h-dvh bg-background lg:flex">
      {/* Applies the user's saved theme/color-mode to <html>; renders nothing. */}
      <ThemeSync />
      {/* The item detail drawer, opened from any item card / dashboard row via the drawer store. */}
      <ItemDrawer />

      <aside
        className={cn(
          'sticky top-0 hidden h-dvh shrink-0 overflow-hidden border-r border-border transition-[width] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] lg:block',
          collapsed ? 'w-14' : 'w-56',
        )}
      >
        {collapsed ? (
          <CollapsedSidebar onToggle={() => setCollapsed(false)} />
        ) : (
          <AppSidebar onToggle={() => setCollapsed(true)} />
        )}
      </aside>

      <MobileDrawer />

      <div className="relative flex min-h-dvh min-w-0 flex-1 flex-col">
        {/* Ambient backdrop mirroring the live app: a faint dot grid + blue/cyan glow blobs,
            pointer-transparent and behind the content. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute inset-0 [background-image:radial-gradient(rgba(255,255,255,0.03)_1px,transparent_1px)] [background-size:24px_24px]" />
          <div className="absolute left-1/3 top-[-10%] h-[420px] w-[560px] -translate-x-1/2 rounded-full bg-blue-500/[0.06] blur-3xl" />
          <div className="absolute right-1/4 top-[5%] h-[280px] w-[360px] rounded-full bg-cyan-500/[0.05] blur-3xl" />
        </div>

        <AppTopbar />
        {/* No max-width: content fills the space the rail leaves, matching the legacy app.
            overflow-x-clip (never -hidden): `hidden` on one axis coerces the other to `auto`,
            which would turn <main> into a scroll container and break the invariant above.
            `clip` clips horizontally without establishing one. flex-col so a child can `flex-1`
            to fill the remaining height (the nested 404 / error screens do). */}
        <main className="flex w-full min-w-0 flex-1 flex-col overflow-x-clip px-4 py-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  )
}
