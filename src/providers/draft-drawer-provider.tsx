'use client'

import { useState } from 'react'
import { useDraftDrawerStore } from '@/stores/draft-drawer-store'
import type { DraftDrawerCallbacks } from '@/stores/draft-drawer-store'
import { useIsTouch } from '@/hooks/ui/use-is-touch'
import { MobileItemPaneSlider } from '@/components/items/drawer/mobile-item-pane-slider'
import { MobileDraftFullScreenView } from '@/components/parse/parse-draft-card'
import type { BrainDumpDraftItem } from '@/hooks/items/use-brain-dump'
import type { WithChildren } from '@/types/common'

interface DraftDrawerPane {
  item: BrainDumpDraftItem
  callbacks: DraftDrawerCallbacks
}

const noop = () => {}
const noopAsync = async () => {}

// Renders MobileItemPaneSlider above <main> for the draft edit drawer (mobile only).
// Mirrors ItemDrawerProvider: by rendering outside <main>'s overflow-x-clip containing block,
// the slider's fixed inset-0 overlay anchors to the viewport rather than <main>'s bounds.
// Desktop EditDraftDrawer is unchanged — it still renders DrawerShell inline.
export function DraftDrawerProvider({ children }: WithChildren) {
  const { open, item, targetCollections, busy, canCommit, inTrash, callbacks } = useDraftDrawerStore()
  const isTouch = useIsTouch()

  // Latch the last non-null item + callbacks so the closing slide keeps rendering them after the store
  // clears on close (the owning card may also unmount, so we can't read live callbacks during the slide).
  const [pane, setPane] = useState<DraftDrawerPane | null>(null)
  if (open && item && callbacks && item.id !== pane?.item.id) setPane({ item, callbacks })

  if (!isTouch) return <>{children}</>

  return (
    <MobileItemPaneSlider
      page={children}
      open={open}
      openScrollY={0}
      renderPane={({ isSettled, onSwipeCloseStart }) => (
        <MobileDraftFullScreenView
          item={pane?.item ?? null}
          open={open}
          targetCollections={targetCollections}
          onSave={pane?.callbacks.onSave ?? noopAsync}
          onOpenChange={pane?.callbacks.onOpenChange ?? noop}
          isSettled={isSettled}
          onSwipeCloseStart={onSwipeCloseStart}
          busy={busy}
          canCommit={canCommit}
          inTrash={inTrash}
          onTrash={pane?.callbacks.onTrash ?? noop}
          onRestore={pane?.callbacks.onRestore ?? noop}
          onDeleteForever={pane?.callbacks.onDeleteForever ?? noop}
          onCommit={pane?.callbacks.onCommit ?? noop}
        />
      )}
    />
  )
}
