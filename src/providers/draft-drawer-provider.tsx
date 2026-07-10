'use client'

import { useCallback, useMemo, useState } from 'react'
import { useDraftDrawerStore } from '@/stores/draft-drawer-store'
import type { DraftDrawerCallbacks } from '@/stores/draft-drawer-store'
import { useIsTouch } from '@/hooks/ui/use-is-touch'
import { MobileDrawerHost } from '@/components/items/drawer/drawer-shared'
import { DrawerShell } from '@/components/items/drawer/drawer-shell'
import { MobileDraftFullScreenView, DraftEditBody } from '@/components/parse/parse-draft-card'
import type { BrainDumpDraftItem } from '@/hooks/items/use-brain-dump'
import type { SheetCloseRef } from '@/hooks/ui/use-register-sheet-close'
import type { WithChildren } from '@/types/common'

interface DraftDrawerPane {
  item: BrainDumpDraftItem
  callbacks: DraftDrawerCallbacks
}

// Placeholder action callbacks for the brief window before any pane has latched (the host/Sheet renders no
// body then, so these are never actually called — they only satisfy the always-mounted shell's prop types).
const noop = () => {}

// The provider-level draft edit drawer — the SINGLE mount path for both platforms, mirroring how
// ItemDrawerProvider hosts the live item drawer. Draft cards no longer render their own DrawerShell; each card's
// EditDraftDrawer just syncs open state + callbacks into DraftDrawerStore, and this provider (mounted above
// <main>) renders the actual drawer from that store:
//  • Desktop: the right-side DrawerShell Sheet (resize, swipe-to-dismiss, grab handle, close-ref plumbing).
//  • Mobile: the shared MobileDrawerHost (slider + swipe-close panel) — the same host the live item drawer uses.
// Both feed the shared DraftEditBody. Rendering above <main> keeps the mobile host's fixed overlay anchored to
// the viewport (outside <main>'s overflow-x-clip), and means the desktop Sheet no longer needs stopPropagation
// (it's no longer nested under a draft card's clickable root in the React tree).
export function DraftDrawerProvider({ children }: WithChildren) {
  const { open, item, targetCollections, busy, canCommit, inTrash, openScrollY, callbacks } = useDraftDrawerStore()
  const isTouch = useIsTouch()

  // Latch the last non-null item + callbacks so the closing animation keeps rendering them after the store
  // clears on close (the owning card may also unmount, so we can't read live callbacks during the close).
  const [pane, setPane] = useState<DraftDrawerPane | null>(null)
  if (open && item && callbacks && item.id !== pane?.item.id) setPane({ item, callbacks })

  // Close the STORE directly (mirrors ItemDrawerProvider) — this flips the drawer's `open` prop and dismisses
  // it. The drawer body lives in THIS provider tree while the owning card lives in the page tree; they couple
  // only through the store, so bouncing close through the card's latched `setEditOpen` was a no-op. The card
  // subscribes to the store and resets its own `editOpen` (clearing `?item=` and staying reopenable) when this
  // close lands. On open we ignore — the store is already open.
  // Reads the store fresh via getState() rather than a closed-over value, so no dependency is needed — safe to
  // hand out a single stable reference to every prop site below (MobileDrawerHost, both bodies, DrawerShell).
  const onOpenChange = useCallback((next: boolean) => {
    if (!next) useDraftDrawerStore.getState().closeDrawer()
  }, [])

  // Action callbacks from the latched pane (undefined until one latches; only read inside the `pane ? …`
  // branches below, so the no-op fallbacks are never actually invoked). Memoized so the prop identity only
  // changes when one of its real inputs does, not on every unrelated store update.
  const sharedActionProps = useMemo(
    () => ({
      busy,
      canCommit,
      inTrash,
      onTrash: pane?.callbacks.onTrash ?? noop,
      onRestore: pane?.callbacks.onRestore ?? noop,
      onDeleteForever: pane?.callbacks.onDeleteForever ?? noop,
      onCommit: pane?.callbacks.onCommit ?? noop,
    }),
    [busy, canCommit, inTrash, pane],
  )

  // Touch: ALWAYS render MobileDrawerHost with `children` as its `page` — open or closed, latched or not —
  // exactly like ItemDrawerProvider. `children` must keep ONE stable tree position: if it moved between a bare
  // `<>{children}</>` (closed) and `MobileDrawerHost`'s slider wrapper (open), React would destroy and recreate
  // the whole page subtree on the first open, visibly remounting/reflowing the board (the "page refresh" flash).
  // The host's pane is null until a pane latches, so it renders nothing over the page until then.
  const renderMobileBody = useCallback(
    ({ sheetCloseRef }: { sheetCloseRef: SheetCloseRef }) =>
      pane ? (
        <MobileDraftFullScreenView
          item={pane.item}
          targetCollections={targetCollections}
          onSave={pane.callbacks.onSave}
          onOpenChange={onOpenChange}
          sheetCloseRef={sheetCloseRef}
          {...sharedActionProps}
        />
      ) : null,
    [pane, targetCollections, onOpenChange, sharedActionProps],
  )

  if (isTouch) {
    return (
      <MobileDrawerHost
        page={children}
        open={open}
        openScrollY={openScrollY}
        decoration="none"
        resetKey={pane?.item.id ?? null}
        onOpenChange={onOpenChange}
        renderBody={renderMobileBody}
      />
    )
  }

  // Desktop: `children` renders straight through; the Sheet is a sibling. Always mounted (animates on `open`),
  // body null until a pane latches.
  return (
    <>
      {children}
      <DrawerShell open={open} onOpenChange={onOpenChange}>
        {(sheetCloseRef) =>
          pane ? (
            <DraftEditBody
              item={pane.item}
              targetCollections={targetCollections}
              onSave={pane.callbacks.onSave}
              onOpenChange={onOpenChange}
              sheetCloseRef={sheetCloseRef}
              {...sharedActionProps}
            />
          ) : null
        }
      </DrawerShell>
    </>
  )
}
