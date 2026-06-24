'use client'

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Dialog } from '@base-ui/react/dialog'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { useResizable } from '@/hooks/ui/use-resizable'
import { useSwipeToDismiss } from '@/hooks/ui/use-swipe-to-dismiss'
import { useGrabHandleDrag } from '@/hooks/ui/use-grab-handle-drag'
import { usePressHighlight } from '@/hooks/ui/use-press-highlight'
import { useEditorFullscreenStore } from '@/stores/editor-fullscreen'
import { cn } from '@/lib/utils'
import { SWIPE_GRIP_PILL_CLASS } from './drawer-shared'
import { SHEET_CONTENT_SELECTOR } from '@/lib/dom/drawer-selectors'
import type { SheetCloseRef } from '@/hooks/ui/use-register-sheet-close'

interface DrawerShellProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Desktop default width in px (resizable). Both drawers use 560. */
  defaultWidth?: number
  /**
   * When true, wraps the Sheet in a stop-propagation div. The Brain Dump draft drawer needs this: its
   * Sheet portals to <body> in the DOM, but in the REACT tree it sits under the draft card's clickable
   * root (`onClick={openEditor}`), and React bubbles synthetic events along the REACT tree — so a click
   * inside the drawer (or on its backdrop) would close it AND bubble up to reopen it. The live item
   * drawer has no such clickable ancestor, so it leaves this off.
   */
  stopPropagation?: boolean
  /**
   * Renders the drawer body. Receives the `sheetCloseRef` the body must register its guarded-close into
   * (via `useRegisterSheetClose`), so Esc / backdrop / swipe all run through the body's dirty guard.
   */
  children: (sheetCloseRef: SheetCloseRef) => ReactNode
}

/**
 * The shared right-side drawer shell for both the live item drawer and the Brain Dump draft drawer.
 * Owns everything the two had duplicated: the Sheet + resizable width (inner-edge drag strip + drag
 * overlay), mobile swipe-to-dismiss with the body-portaled grab handle, the editor-fullscreen gate, and
 * the `sheetCloseRef` plumbing that routes Esc / backdrop / swipe through the body's dirty guard. The
 * body (edit/view content) is supplied via the `children` render prop and gets the close ref.
 */
export function DrawerShell({ open, onOpenChange, defaultWidth = 560, stopPropagation = false, children }: DrawerShellProps) {
  const { width, minWidth, maxWidth, dragging, startResize, onMouseMove, onMouseUp, setWidth } = useResizable({
    defaultWidth,
    maxBoundarySelector: 'main',
    maxBoundaryGapVw: 0.1,
  })
  const grip = usePressHighlight()
  // A maximized content editor covers the whole drawer; swipe-to-dismiss is disabled while it is
  // fullscreen so a swipe over the editor can't close the drawer — the user collapses it first.
  const editorFullscreen = useEditorFullscreenStore((s) => s.fullscreen)

  // Outside-press / Esc / swipe all funnel through here. The body content registers a mode-aware guarded
  // close in sheetCloseRef, so every dismissal is intercepted: edit mode prompts to discard unsaved
  // changes, view mode closes directly. We do NOT disable dismissal while editing — silently swallowing
  // a backdrop click or swipe felt broken; routing through the guard shows the discard dialog instead.
  const sheetCloseRef = useRef<(() => void) | null>(null)

  function handleSheetOpenChange(nextOpen: boolean, eventDetails?: Dialog.Root.ChangeEventDetails) {
    if (nextOpen) return
    // The markdown editor/viewer is portaled OUT of the drawer's DOM (on touch and in fullscreen), so a
    // press inside it reads as a base-ui "outside press". Ignore those — interacting with the editor must
    // never dismiss the drawer (otherwise every tap-to-type would pop the guard).
    if (eventDetails?.reason === 'outside-press') {
      const target = eventDetails.event?.target
      if (target instanceof Element && target.closest('[data-editor-overlay]')) {
        eventDetails.cancel()
        return
      }
    }
    if (sheetCloseRef.current) {
      sheetCloseRef.current()
    } else {
      onOpenChange(false)
    }
  }

  // Swipe-to-dismiss from within the drawer body (anywhere inside the sheet content). The grab handle
  // uses a separate bidirectional hook below — this covers gestures that begin inside the drawer itself.
  const swipe = useSwipeToDismiss({
    onDismiss: () => handleSheetOpenChange(false),
    distanceThreshold: 90,
    enabled: !editorFullscreen,
  })

  // Shared ref to the sheet DOM element — populated by the RAF sync loop below.
  const sheetElRef = useRef<HTMLElement | null>(null)

  // Grab handle bidirectional drag: left = widen, right = narrow; at min width rightward drag
  // slides the sheet to signal dismiss and any release in that state closes the drawer.
  const grabDrag = useGrabHandleDrag({
    onDismiss: () => handleSheetOpenChange(false),
    onResize: setWidth,
    drawerWidth: width,
    minWidth,
    maxWidth,
    enabled: !editorFullscreen,
    sheetRef: sheetElRef,
  })

  // Body swipe drives the sheet transform for gestures that start inside the drawer content area.
  // The grab handle writes transforms directly to the DOM, so it doesn't contribute to this style.
  const sheetDragStyle: CSSProperties = swipe.dragStyle

  // The grab handle is portaled to <body> (it must paint above the editor/viewer overlay, itself a body
  // portal that covers the drawer), so it lives OUTSIDE the drawer's DOM and can't inherit the drawer's
  // open/close/drag transform. To keep it STRICTLY bound to the drawer's edge with zero drift, we mirror
  // that transform every frame: read the drawer's live left edge and translate the handle's rail to
  // match. This holds through the open slide, the close slide, and a swipe-drag. Direct style writes via
  // a ref — no setState, so it never re-renders or trips set-state-in-effect. The rail's initial
  // translateX(100vw) matches the drawer's off-screen start, so it never flashes at the left edge on
  // mount before the first frame runs. (sheetElRef is declared above, ahead of useGrabHandleDrag.)
  const railRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open || editorFullscreen) return
    let raf = 0
    const sync = () => {
      // Query once and cache; the `??=` re-queries only until it first appears (portal may mount
      // a frame after this effect runs). document.querySelector is required because the sheet is portaled
      // outside this component's subtree, so we can't pass a ref from the Sheet component.
      sheetElRef.current ??= document.querySelector<HTMLElement>(SHEET_CONTENT_SELECTOR)
      const rail = railRef.current
      const sheet = sheetElRef.current
      if (rail && sheet) {
        rail.style.transform = `translateX(${sheet.getBoundingClientRect().left}px)`
      }
      raf = requestAnimationFrame(sync)
    }
    raf = requestAnimationFrame(sync)
    return () => {
      cancelAnimationFrame(raf)
      sheetElRef.current = null
    }
  }, [open, editorFullscreen])

  const sheet = (
    <Sheet open={open} onOpenChange={handleSheetOpenChange}>
      <SheetContent
        side="right"
        // Mobile: full-width so the content area is maximised and nothing is cut off.
        // Desktop (sm+): the resizable px width from useResizable.
        className="flex flex-col gap-0 p-0 max-sm:!w-full"
        // sheetDragStyle drives the touch swipe-to-dismiss drag (a gesture can't be expressed with
        // classes); width/maxWidth are the resize sizing.
        style={{ width, maxWidth: 'none', ...sheetDragStyle }}
        showCloseButton={false}
        {...swipe.handlers}
      >
        {/* Desktop resize handle: a thin strip along the inner (left) edge — drag to widen/narrow. No
            always-visible grip pill (it read as a swipe indicator on desktop); the strip itself brightens
            on hover and while dragging. Hidden on mobile, which uses the swipe-to-dismiss grab handle. */}
        <div
          className={cn(
            'absolute left-0 top-0 z-10 h-full w-1.5 cursor-ew-resize transition-colors max-sm:hidden',
            dragging ? 'bg-primary/40' : 'hover:bg-primary/30',
          )}
          onMouseDown={startResize}
        />

        {dragging && (
          <div className="fixed inset-0 z-[60] cursor-ew-resize select-none" onMouseMove={onMouseMove} onMouseUp={onMouseUp} />
        )}

        {children(sheetCloseRef)}
      </SheetContent>
    </Sheet>
  )

  return (
    <>
      {stopPropagation ? <div onClick={(event) => event.stopPropagation()}>{sheet}</div> : sheet}

      {/* Touch grab handle, PORTALED to <body> at z-[55]. It must live above the markdown
          editor/viewer (itself portaled to <body> as a fixed z-50 overlay that covers the drawer) —
          a handle rendered inside the drawer (a lower stacking context) sits behind that overlay, so
          presses and swipes never reach it. Bidirectional: swipe right → dismiss, swipe left →
          widen the drawer. `touch-none` yields horizontal swipes to our JS, not the browser's edge
          "back" gesture. Shown only on coarse-pointer (touch) devices. Only mounted while open. */}
      {open &&
        !editorFullscreen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={railRef}
            style={{ transform: 'translateX(100vw)' }}
            className="pointer-events-none fixed inset-y-0 left-0 z-[55] hidden items-center [@media(pointer:coarse)]:flex"
          >
            <div
              aria-hidden="true"
              {...grabDrag.handlers}
              {...grip.handlers}
              className="pointer-events-auto flex h-3/5 max-h-72 min-h-40 w-16 touch-none items-center justify-start pl-1"
            >
              <div className={cn(SWIPE_GRIP_PILL_CLASS, 'transition-colors', grip.pressed ? 'bg-primary/70' : 'bg-foreground/30')} />
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
