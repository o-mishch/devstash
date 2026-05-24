import { Archive, FolderPlus, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SidebarContent } from './sidebar-content'
import { MobileDrawer } from './mobile-drawer'
import type { CollectionWithTypes } from '@/lib/db/collections'
import type { SidebarItemType } from '@/lib/db/items'

export interface SidebarUser {
  name: string | null
  email: string | null
  image: string | null
}

export interface SidebarData {
  collections: CollectionWithTypes[]
  itemTypes: SidebarItemType[]
  user: SidebarUser | null
}

interface DashboardLayoutProps {
  children: React.ReactNode
  sidebarData: SidebarData
}

export function DashboardLayout({ children, sidebarData }: DashboardLayoutProps) {

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
        <MobileDrawer sidebarData={sidebarData} />

        <Archive className="size-4 shrink-0 text-primary" />
        <span className="shrink-0 text-base font-semibold tracking-tight">DevStash</span>

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
        <SidebarContent sidebarData={sidebarData} collapsible />

        <main className="flex flex-1 flex-col overflow-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
