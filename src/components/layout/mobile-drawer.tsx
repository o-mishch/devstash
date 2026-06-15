'use client' // required: controls Sheet open state with useState

import { useState } from 'react'
import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { useSwipeToDismiss } from '@/hooks/use-swipe-to-dismiss'
import { SidebarContent } from './sidebar-content'
import type { SidebarData } from '@/types/sidebar'

interface MobileDrawerProps {
  sidebarData: SidebarData
}

export function MobileDrawer({ sidebarData }: MobileDrawerProps) {
  const [open, setOpen] = useState(false)
  // Left-anchored: a leftward (right-to-left) swipe slides it off-screen to close.
  const swipe = useSwipeToDismiss({ direction: 'left', onDismiss: () => setOpen(false) })

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="size-11 shrink-0 lg:hidden"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
      >
        <Menu className="size-5" />
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="left"
          className="w-64 p-0"
          showCloseButton={false}
          // dragStyle drives the touch swipe-to-dismiss drag (a gesture can't be expressed
          // with classes); cleared while idle so the close animation runs.
          style={swipe.dragStyle}
          {...swipe.handlers}
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarContent sidebarData={sidebarData} onClose={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  )
}
