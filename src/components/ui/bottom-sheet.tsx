'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode, type UIEvent, type PointerEvent } from 'react'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { useSwipeToDismiss } from '@/hooks/ui/use-swipe-to-dismiss'
import { usePressHighlight } from '@/hooks/ui/use-press-highlight'
import { useVisualViewport } from '@/hooks/ui/use-visual-viewport'
import { cn } from '@/lib/utils'

interface BottomSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  // Render prop so the body can react to scroll (e.g. shrink its footer) the same way the sheet's
  // own header collapses. `scrolled` is true once the inner scroll container has left the top.
  children: (scrolled: boolean) => ReactNode
  className?: string
  // When true the grab handle resizes the sheet instead of dismissing it: dragging up grows the
  // sheet (a flex-filling body, e.g. a description box, grows with it), dragging down shrinks it,
  // and releasing below a small height dismisses. The handle owns the gesture, so swipe-to-dismiss
  // is disabled and the body scrolls normally.
  resizable?: boolean
  // Lift the sheet (backdrop + content) above another open drawer/dialog at z-50 and force its
  // backdrop so the surface behind dims — for a bottom sheet opened from inside the item drawer.
  elevated?: boolean
}

// h-14 app header the sheet rises just beneath; the resize gesture is clamped to leave it visible.
const APP_HEADER_PX = 56
// Smallest height the sheet resizes to (Description ~one line). Dragging down further doesn't
// shrink it more — it slides the whole sheet down (dragShift), and releasing past
// DISMISS_OVERSHOOT_PX dismisses, so "drag down at minimum = close".
const MIN_USABLE_PX = 320
const DISMISS_OVERSHOOT_PX = 80

// A mobile bottom sheet with a grab handle and swipe-down-to-close — the vertical twin of the
// right-anchored drawer's swipe-to-dismiss. Shared by the item- and collection-create flows so
// both feel identical on touch. Drag engages from the handle/header, or from the body once it's
// scrolled to the top (see useSwipeToDismiss); otherwise the body scrolls normally. With
// `resizable`, the handle instead drives a height drag (see BottomSheetProps.resizable).
export function BottomSheet({ open, onOpenChange, title, description, children, className, resizable = false, elevated = false }: BottomSheetProps) {
  const { dragStyle, handlers } = useSwipeToDismiss({
    direction: 'down',
    threshold: 0.3,
    enabled: !resizable,
    onDismiss: () => onOpenChange(false),
  })
  // Press state for the plain (non-resizable) grab handle; the resizable handle uses `resizing`.
  const grip = usePressHighlight()
  const [scrolled, setScrolled] = useState(false)

  // When the on-screen keyboard opens it covers the lower part of the screen. The sheet is a fixed
  // `bottom-0` panel, so without this its footer and any low fields sit *behind* the keyboard.
  const viewport = useVisualViewport()
  const keyboardOpen = (viewport?.keyboardHeight ?? 0) > 0

  // Lift the sheet to rest directly on top of the keyboard and cap its height to the visible area,
  // so the footer and the focused field stay above the keyboard instead of hidden behind it.
  const keyboardStyle: CSSProperties = viewport
    ? {
        bottom: viewport.keyboardHeight > 0 ? viewport.keyboardHeight : undefined,
        maxHeight: viewport.height,
      }
    : {}

  // Scroll the sheet's form body to reveal the focused field above the keyboard. iOS doesn't
  // scroll inputs into view correctly inside a fixed sheet, so we do it ourselves.
  // Walk up to the OUTERMOST overflow-y:auto/scroll ancestor inside the sheet (not the first):
  // Monaco and other rich editors have their own internal overflow-y:auto containers that appear
  // first when walking upward from the focused element. The outermost container is always the
  // form body, which is what needs to scroll to bring the editor block into view.
  const centerFocusedField = useCallback(() => {
    const active = document.activeElement
    if (!(active instanceof HTMLElement)) return
    if (!active.closest('[data-slot=sheet-content]')) return
    // Skip when focus is on a dropdown/combobox trigger (Language, Collections, Type, …). Opening
    // an in-sheet dropdown moves focus to its trigger; scrolling to "center" it then drags the
    // popover — which is anchored to the trigger — upward, the jump seen when opening those menus.
    // The popover owns its own positioning, so the sheet must stay put. Real text inputs (Title,
    // Tags, Description) carry none of these markers, so keyboard-avoidance for them is unaffected.
    if (active.closest('[aria-haspopup],[aria-expanded],[role=combobox]')) return

    // Find the sheet's scrollable body — walk up without breaking so we capture the outermost
    // overflow-y:auto/scroll ancestor rather than an editor's internal scroll container.
    let scrollEl: HTMLElement | null = null
    let el: HTMLElement | null = active.parentElement
    while (el) {
      if (el.dataset.slot === 'sheet-content') break
      const oy = getComputedStyle(el).overflowY
      if (oy === 'auto' || oy === 'scroll') { scrollEl = el }
      el = el.parentElement
    }

    if (!scrollEl) { active.scrollIntoView({ block: 'center' }); return }

    const bodyRect = scrollEl.getBoundingClientRect()
    const activeRect = active.getBoundingClientRect()
    // The sheet is lifted to rest directly on the keyboard (keyboardStyle below), so the scroll body's
    // bottom edge IS the keyboard top. Rest the focused field's BOTTOM just above it (12px breathing
    // room) so the field the user tapped sits right on top of the keyboard — not near the sheet's top.
    const GAP = 12
    const fieldBottomInBody = scrollEl.scrollTop + activeRect.bottom - bodyRect.top
    let target = fieldBottomInBody + GAP - scrollEl.clientHeight
    // If the field is taller than the visible area (a multi-line Description), don't push its top off
    // the top edge — clamp so the field's top (and its label) stays in view, preferring to show the top.
    const fieldTopInBody = scrollEl.scrollTop + activeRect.top - bodyRect.top
    const labelRoom = 28 // room above the field for its label
    if (target > fieldTopInBody - labelRoom) target = fieldTopInBody - labelRoom
    scrollEl.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
  }, [])

  // Re-centre once the keyboard inset settles — rAF lets the sheet finish resizing before we
  // measure element positions, avoiding a no-op scroll against stale layout geometry.
  useEffect(() => {
    if (!keyboardOpen) return
    const id = requestAnimationFrame(centerFocusedField)
    return () => cancelAnimationFrame(id)
  }, [keyboardOpen, centerFocusedField])

  // …and immediately when focus moves between fields while the keyboard is already open.
  useEffect(() => {
    if (!open) return
    const onFocusIn = () => requestAnimationFrame(centerFocusedField)
    document.addEventListener('focusin', onFocusIn)
    return () => document.removeEventListener('focusin', onFocusIn)
  }, [open, centerFocusedField])

  // Resizable mode: the sheet height is driven by the handle drag. Null means "use the default
  // height class" (before the first drag); a number pins an explicit pixel height.
  const [dragHeight, setDragHeight] = useState<number | null>(null)
  const dragHeightRef = useRef<number | null>(null)
  // Downward offset applied once the drag pushes below MIN_USABLE_PX: the sheet stops shrinking and
  // slides off-screen instead, so a release past DISMISS_OVERSHOOT_PX reads as a dismiss.
  const [dragShift, setDragShift] = useState(0)
  const dragShiftRef = useRef(0)
  // Disables the sheet's transform/opacity transition while actively dragging so it tracks the
  // finger; re-enabled on release so the snap-back (and close) animate.
  const [resizing, setResizing] = useState(false)
  const resizingRef = useRef(false)
  const sheetElRef = useRef<HTMLElement | null>(null)
  const startYRef = useRef(0)
  const startHRef = useRef(0)

  function applyHeight(value: number | null) {
    dragHeightRef.current = value
    setDragHeight(value)
  }

  function applyShift(value: number) {
    dragShiftRef.current = value
    setDragShift(value)
  }

  // Reset the pinned height each time the sheet opens so every open starts from the default height
  // (resetting on close would jump the height mid close-animation).
  function handleSheetOpenChange(next: boolean) {
    if (next) {
      applyHeight(null)
      applyShift(0)
    }
    onOpenChange(next)
  }

  function handleResizeStart(e: PointerEvent<HTMLDivElement>) {
    resizingRef.current = true
    setResizing(true)
    sheetElRef.current = e.currentTarget.closest('[data-slot=sheet-content]')
    startYRef.current = e.clientY
    startHRef.current = sheetElRef.current?.getBoundingClientRect().height ?? 0
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function handleResizeMove(e: PointerEvent<HTMLDivElement>) {
    if (!resizingRef.current) return
    // Dragging up (clientY decreases) grows the sheet. window.innerHeight is the only source of the
    // current viewport height during a pointer gesture — there is no React/Next equivalent.
    const delta = startYRef.current - e.clientY
    const maxPx = window.innerHeight - APP_HEADER_PX
    const raw = startHRef.current + delta
    if (raw >= MIN_USABLE_PX) {
      applyHeight(Math.min(raw, maxPx))
      applyShift(0)
    } else {
      // Below the minimum the sheet stops shrinking and instead slides down by the overshoot.
      applyHeight(MIN_USABLE_PX)
      applyShift(MIN_USABLE_PX - raw)
    }
  }

  function handleResizeEnd(e: PointerEvent<HTMLDivElement>) {
    if (!resizingRef.current) return
    resizingRef.current = false
    setResizing(false)
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    if (dragShiftRef.current > DISMISS_OVERSHOOT_PX) {
      // Clear the inline height/transform so the sheet's normal close (slide-out) animation runs.
      applyHeight(null)
      applyShift(0)
      onOpenChange(false)
    } else {
      // Snap back up to the minimum usable height (transition re-enabled now resizing is false).
      applyShift(0)
    }
  }

  // The form body inside `children` is the scroll container; scroll events don't bubble, so we
  // listen in the capture phase (onScrollCapture) to learn when it has moved off the top. Past a
  // few px we collapse the description and tighten the title so the header stops permanently
  // spending vertical space on context the user has already read.
  function handleScrollCapture(e: UIEvent<HTMLDivElement>) {
    const target = e.target
    if (target instanceof HTMLElement) setScrolled(target.scrollTop > 4)
  }

  return (
    <Sheet open={open} onOpenChange={handleSheetOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        elevated={elevated}
        style={{
          ...(resizable
            ? {
                height: dragHeight ? `${dragHeight}px` : undefined,
                transform: dragShift ? `translateY(${dragShift}px)` : undefined,
                transition: resizing ? 'none' : undefined,
              }
            : dragStyle),
          // Lift above the keyboard last so it overrides the base `bottom-0` / `max-h` (compatible
          // with the drag transform, which only sets `transform`).
          ...keyboardStyle,
        }}
        onScrollCapture={handleScrollCapture}
        {...(resizable ? {} : handlers)}
        // Timing (duration + easing) is inherited from the shared SheetContent base so the bottom
        // sheet and the right-side drawer open/close at the same speed. Only layout is set here.
        // Rises to just below the app header (h-14 = 3.5rem). Slim horizontal padding (px-3) so the
        // form body — especially the code/markdown editor — reclaims width on narrow screens.
        // Resizable mode opens at a roomy default height (overridden by the drag's inline height).
        className={cn(
          'flex max-h-[calc(100dvh-3.5rem)] flex-col gap-0 rounded-t-2xl px-3 pt-2 pb-3',
          // Match the sheet base's `data-[side=bottom]:h-auto` variant so tailwind-merge replaces it
          // (a plain `h-[60dvh]` would not dedupe the variant and the sheet would hug its content).
          resizable && 'data-[side=bottom]:h-[60dvh] min-h-[200px]',
          className,
        )}
      >
        {/* Grab handle: a swipe-down target by default; a resize drag target when `resizable`. */}
        {resizable ? (
          <div
            onPointerDown={handleResizeStart}
            onPointerMove={handleResizeMove}
            onPointerUp={handleResizeEnd}
            onPointerCancel={handleResizeEnd}
            // Interactive drag handle that resizes the sheet, with a nested pill visual as its
            // child. <hr> is a void element — it can't hold that child — and native <hr> semantics
            // don't cover a draggable resize control.
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize sheet"
            // Tall, full-width grab zone (not just the thin pill) so a press slightly above or below
            // the pill still starts the resize drag — no pixel-perfect aim. -mt-3 extends the zone up
            // toward the sheet's top edge while keeping the pill near the top; touch-none keeps the
            // browser from cancelling the gesture mid-drag.
            className="mx-auto -mt-3 flex h-11 w-full shrink-0 cursor-row-resize touch-none items-center justify-center"
          >
            {/* Stays highlighted for the whole drag (resizing is set on pointer-down). */}
            <div className={cn('h-1.5 w-10 rounded-full transition-colors', resizing ? 'bg-primary/70' : 'bg-foreground/20')} />
          </div>
        ) : (
          // Swipe-down grab handle — same rule as the right-side drawer's indicator: a press well
          // above OR below the pill still counts as pressing it. The visible pill stays in normal
          // flow (its slot, so the header sits below it); the actual press target is the larger
          // TRANSPARENT overlay, which OVERLAPS the top of the header WITHOUT pushing it down (it
          // ends well above the first form field) instead of widening the thin pill in flow. A press
          // anywhere in it highlights the pill; the swipe-down gesture itself lives on the whole
          // SheetContent (see `handlers` above), so the press still drives the dismiss. touch-none
          // keeps the browser from cancelling the press mid-swipe; pointer-captured so the highlight
          // holds for the whole press.
          <>
            <div
              aria-hidden="true"
              {...grip.handlers}
              className="absolute inset-x-0 top-0 z-10 h-20 touch-none"
            />
            <div aria-hidden="true" className="mx-auto mt-0.5 mb-1.5 flex h-5 w-full shrink-0 items-center justify-center">
              <div className={cn('h-1.5 w-10 rounded-full transition-colors', grip.pressed ? 'bg-primary/70' : 'bg-foreground/20')} />
            </div>
          </>
        )}
        <div
          className={cn(
            'flex shrink-0 flex-col border-b border-border/50 transition-all duration-200',
            scrolled ? 'gap-0 pb-1.5' : 'gap-0.5 pb-2',
          )}
        >
          <SheetTitle className={cn('transition-all duration-200', scrolled && 'text-sm')}>{title}</SheetTitle>
          {description ? (
            // grid-rows 1fr→0fr collapses the description height smoothly; the inner p must clip.
            <div
              className={cn(
                'grid transition-all duration-200',
                scrolled ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100',
              )}
            >
              <p className="overflow-hidden text-xs text-muted-foreground">{description}</p>
            </div>
          ) : null}
        </div>
        {children(scrolled)}
      </SheetContent>
    </Sheet>
  )
}
