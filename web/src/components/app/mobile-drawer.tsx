import type { ReactElement } from 'react'
import { useUIStore } from '@/stores/ui'
import { useSwipeToDismiss } from '@/hooks/use-swipe-to-dismiss'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { AppSidebar } from './app-sidebar'

/**
 * The mobile navigation drawer. Uses the same Sheet (and therefore the same slide timing) as the
 * item drawer, plus swipe-left-to-dismiss. Renders the expanded sidebar — the collapse rail is a
 * desktop-only affordance, so no toggle is passed.
 */
export function MobileDrawer(): ReactElement {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen)

  const swipe = useSwipeToDismiss({
    direction: 'left',
    onDismiss: () => {
      setSidebarOpen(false)
    },
  })

  return (
    <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
      <SheetContent
        side="left"
        className="w-64 p-0 lg:hidden"
        showCloseButton={false}
        // oxlint-disable-next-line react/forbid-component-props -- drag gesture transform
        style={swipe.dragStyle}
        {...swipe.handlers}
      >
        {/* The drawer's heading is the brand link inside AppSidebar; this names the dialog for
            screen readers without duplicating it visually. */}
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <AppSidebar />
      </SheetContent>
    </Sheet>
  )
}
