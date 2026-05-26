import { Suspense } from 'react'
import Link from 'next/link'
import { Archive, FolderPlus, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SidebarContent } from '@/components/layout/sidebar-content'
import { SidebarSkeleton } from '@/components/layout/sidebar-skeleton'
import { MobileDrawer } from '@/components/layout/mobile-drawer'
import { getSidebarData } from '@/lib/db/sidebar'

async function SidebarAsync() {
  const sidebarData = await getSidebarData()
  return <SidebarContent sidebarData={sidebarData} collapsible />
}

async function MobileDrawerAsync() {
  const sidebarData = await getSidebarData()
  return <MobileDrawer sidebarData={sidebarData} />
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
        <Suspense fallback={<div className="size-9 shrink-0 lg:hidden" />}>
          <MobileDrawerAsync />
        </Suspense>

        <Link href="/dashboard" className="flex shrink-0 items-center gap-2 hover:opacity-80 transition-opacity">
          <Archive className="size-4 text-primary" />
          <span className="text-base font-semibold tracking-tight">DevStash</span>
        </Link>

        <div className="relative mx-auto min-w-0 flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search items..." className="pl-8" readOnly />
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" className="hidden sm:flex">
            <FolderPlus className="size-4" />
            New Collection
          </Button>
          <Button size="icon" className="sm:hidden">
            <Plus className="size-4" />
          </Button>
          <Button size="sm" className="hidden sm:flex">
            <Plus className="size-4" />
            New Item
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <Suspense fallback={<SidebarSkeleton />}>
          <SidebarAsync />
        </Suspense>

        <main className="flex flex-1 flex-col overflow-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
