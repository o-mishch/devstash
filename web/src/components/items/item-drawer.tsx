import { useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import type { LightItem } from '@/client'
import { typeHasContent } from '@/lib/item-types'
import { cn } from '@/lib/utils'
import { useItemDrawerStore } from '@/stores/item-drawer'
import { useItemContent, useItemDetails } from '@/hooks/use-item-detail'
import { useResizable } from '@/hooks/use-resizable'
import { useSwipeToDismiss } from '@/hooks/use-swipe-to-dismiss'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { ItemDrawerView } from './item-drawer-view'
import { ItemDrawerEdit } from './item-drawer-edit'

/** Matches the legacy drawer's starting width. Session-only — reopening resets to this. */
const DEFAULT_DRAWER_WIDTH = 560

/**
 * The item detail drawer, mounted once in the app shell. It reads the selected item from the drawer
 * store (set by any item card / dashboard row), fetches its full detail + content on open, and shows
 * a read-only view with an inline edit mode. Renders nothing until an item is selected.
 *
 * Desktop: resizable by dragging the strip on its inner edge (or focusing it and using the arrow
 * keys). Mobile: full-screen, with swipe-right-to-dismiss.
 */
export function ItemDrawer(): ReactNode {
  const item = useItemDrawerStore((s) => s.item)
  const closeDrawer = useItemDrawerStore((s) => s.closeDrawer)

  const { width, minWidth, maxWidth, dragging, startResize, onMouseMove, onMouseUp, setWidth } =
    useResizable({
      defaultWidth: DEFAULT_DRAWER_WIDTH,
      // The drawer is portaled out of the shell, so the boundary is found by selector. It may not
      // exceed <main>'s left edge (less a 10vw breathing gap), keeping the rail visible.
      maxBoundarySelector: 'main',
      maxBoundaryGapVw: 0.1,
    })

  // Touch-only: adds nothing on desktop. A distance threshold (rather than a fraction of the
  // drawer's width) keeps the gesture consistent regardless of how wide it was resized.
  const swipe = useSwipeToDismiss({ onDismiss: closeDrawer, distanceThreshold: 90 })

  // The handle sits on the drawer's left edge, so dragging left widens it — ArrowLeft mirrors that.
  // Shift steps larger, matching common resizable-pane conventions.
  const handleResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? 40 : 10
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setWidth(width + step)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      setWidth(width - step)
    }
  }

  return (
    <Sheet
      open={item !== null}
      onOpenChange={(open) => {
        if (!open) closeDrawer()
      }}
    >
      <SheetContent
        side="right"
        // Mobile: full-width (overriding the base w-3/4) so the item fills the screen.
        // Desktop: the resizable px width below, with maxWidth cleared so it can exceed sm:max-w-sm.
        className="flex flex-col gap-0 p-0 max-sm:!w-full"
        // oxlint-disable-next-line react/forbid-component-props -- resizable px width + drag gesture transform
        style={{ width, maxWidth: 'none', ...swipe.dragStyle }}
        // The view renders its own close button in its header; the Sheet's would duplicate it.
        showCloseButton={false}
        {...swipe.handlers}
      >
        {/* Desktop resize handle: a thin strip along the inner (left) edge. `separator` is the
            standard WAI-ARIA "window splitter" role — an <hr> can't take focus or a keydown
            handler, so it can't stand in for this interactive widget. */}
        <div
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize drawer"
          aria-valuenow={width}
          aria-valuemin={minWidth}
          aria-valuemax={maxWidth}
          tabIndex={0}
          className={cn(
            'absolute left-0 top-0 z-10 h-full w-1.5 cursor-ew-resize transition-colors max-sm:hidden',
            dragging ? 'bg-primary/40' : 'hover:bg-primary/30',
          )}
          onMouseDown={startResize}
          onKeyDown={handleResizeKeyDown}
        />

        {dragging && (
          // Transient mouse-drag capture surface, mounted only while dragging — which is only ever
          // set from the mouse onMouseDown above. Keyboard resizing never sets `dragging`, so
          // keyboard users never reach this surface and it needs no keyboard handling of its own.
          // oxlint-disable-next-line jsx-a11y/no-static-element-interactions
          <div
            className="fixed inset-0 z-[60] cursor-ew-resize select-none"
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
          />
        )}

        {item !== null && <ItemDrawerBody key={item.id} item={item} onClose={closeDrawer} />}
      </SheetContent>
    </Sheet>
  )
}

interface ItemDrawerBodyProps {
  item: LightItem
  onClose: () => void
}

function ItemDrawerBody({ item, onClose }: ItemDrawerBodyProps): ReactNode {
  const [editing, setEditing] = useState(false)
  const hasContent = typeHasContent(item.itemType.name)

  const detailsQuery = useItemDetails(item.id, true)
  const contentQuery = useItemContent(item.id, hasContent)

  const details = detailsQuery.data
  const content = hasContent ? contentQuery.data : null
  const contentReady = !hasContent || content !== undefined

  // Only mount the edit pane once content has loaded — it seeds its form state from these props on
  // mount and does not re-sync, so entering edit mid-load would strand it on empty values. Until
  // then the view stays up with its contentLoading indicator, then the edit pane mounts populated.
  if (editing && contentReady) {
    return (
      <ItemDrawerEdit
        item={item}
        description={details?.description ?? null}
        content={content?.content ?? null}
        language={content?.language ?? null}
        onSaved={() => setEditing(false)}
        onCancel={() => setEditing(false)}
      />
    )
  }

  return (
    <ItemDrawerView
      item={item}
      description={details?.description ?? null}
      collections={details?.collections ?? null}
      updatedAt={details?.updatedAt ?? null}
      content={content?.content ?? null}
      language={content?.language ?? null}
      hasContent={hasContent}
      contentLoading={hasContent && !contentReady}
      onEdit={() => setEditing(true)}
      onClose={onClose}
    />
  )
}
