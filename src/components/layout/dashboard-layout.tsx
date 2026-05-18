'use client'

import { useState } from 'react'
import { Archive, Menu, FolderPlus, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { SidebarContent } from './sidebar-content'

interface DashboardLayoutProps {
  children: React.ReactNode
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
        {/* Mobile only: opens sheet */}
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 lg:hidden"
          onClick={() => setMobileOpen(true)}
        >
          <Menu className="size-4" />
        </Button>

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

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Desktop sidebar — always visible, collapses to icon-only */}
        <aside
          className={`hidden flex-col border-r border-border bg-muted/30 transition-all duration-200 lg:flex ${collapsed ? 'w-14' : 'w-56'}`}
        >
          <SidebarContent
            collapsed={collapsed}
            onToggle={() => setCollapsed((prev) => !prev)}
          />
        </aside>

        {/* Mobile sheet */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-64 p-0" showCloseButton={false}>
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SidebarContent onClose={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>

        {/* Main */}
        <main className="flex flex-1 flex-col overflow-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
