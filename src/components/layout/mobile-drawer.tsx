'use client' // required: controls Sheet open state with useState

import { useState } from 'react'
import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { SidebarContent } from './sidebar-content'
import type { SidebarData } from '@/lib/db/sidebar'

interface MobileDrawerProps {
  sidebarData: SidebarData
}

export function MobileDrawer({ sidebarData }: MobileDrawerProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="shrink-0 lg:hidden"
        onClick={() => setOpen(true)}
      >
        <Menu className="size-4" />
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-64 p-0" showCloseButton={false}>
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarContent sidebarData={sidebarData} onClose={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  )
}
