import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent, ReactNode, UIEvent } from 'react'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { useSwipeToDismiss } from '@/hooks/use-swipe-to-dismiss'
import { usePressHighlight } from '@/hooks/use-press-highlight'
import { useVisualViewport } from '@/hooks/use-visual-viewport'
import { cn } from '@/lib/utils'

interface BottomSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  /**
   * Render prop so the body can react to scroll (e.g. shrink its footer) the same way the sheet's
   * own header collapses. `scrolled` is true once the inner scroll container has left the top.
   */
  children: (scrolled: boolean) => ReactNode
  className?: string
  /**
   * When true the grab handle resizes the sheet instead of dismissing it: dragging up grows the
   * sheet (a flex-filling body grows with it), dragging down shrinks it, and releasing below a
   * small height dismisses. The handle owns the gesture, so swipe-to-dismiss is disabled and the
   * body scrolls normally.
   */
  resizable?: boolean
  /** Lift the sheet above another open drawer/dialog at z-50 — see SheetContent's `elevated`. */
  elevated?: boolean
}

// The h-14 app header the sheet rises just beneath; the resize gesture leaves it visible.
const APP_HEADER_PX = 56
// Smallest height the sheet resizes to. Dragging down further doesn't shrink it more — it slides
// the whole sheet down (dragShift), and releasing past DISMISS_OVERSHOOT_PX dismisses, so
// "drag down at minimum = close".
const MIN_USABLE_PX = 320
const DISMISS_OVERSHOOT_PX = 80

/**
 * A mobile bottom sheet with a grab handle and swipe-down-to-close — the vertical twin of the
 * right-anchored drawer's swipe-to-dismiss. Shared by the item- and collection-create flows so both
 * feel identical on touch. Drag engages from the handle/header, or from the body once it's scrolled
 * to the top; otherwise the body scrolls normally.
 */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  resizable = false,
  elevated = false,
}: BottomSheetProps): ReactNode {
  const onDismiss = useCallback((): void => {
    onOpenChange(false)
  }, [onOpenChange])

  const { dragStyle, handlers } = useSwipeToDismiss({
    direction: 'down',
    threshold: 0.3,
    enabled: !resizable,
    onDismiss,
  })
  // Press state for the plain (non-resizable) grab handle; the resizable handle uses `resizing`.
  const grip = usePressHighlight()
  const [scrolled, setScrolled] = useState(false)

  // When the on-screen keyboard opens it covers the lower part of the screen. The sheet is a fixed
  // bottom-0 panel, so without this its footer and any low fields sit *behind* the keyboard.
  const viewport = useVisualViewport()
  const keyboardOpen = (viewport?.keyboardHeight ?? 0) > 0

  // Rest the sheet directly on top of the keyboard and cap its height to the visible area.
  const keyboardStyle = useMemo<CSSProperties>(() => {
    if (viewport === null) return {}
    return {
      bottom: viewport.keyboardHeight > 0 ? viewport.keyboardHeight : undefined,
      maxHeight: viewport.height,
    }
  }, [viewport])

  // Scroll the sheet's form body to reveal the focused field above the keyboard. iOS doesn't scroll
  // inputs into view correctly inside a fixed sheet, so we do it ourselves. document.activeElement
  // is the only way to read focus here; there is no React equivalent.
  const centerFocusedField = useCallback((): void => {
    const active = document.activeElement
    if (!(active instanceof HTMLElement)) return
    if (!active.closest('[data-slot=sheet-content]')) return
    // Skip when focus is on a dropdown/combobox trigger. Opening an in-sheet dropdown moves focus to
    // its trigger; scrolling to centre it then drags the popover — which is anchored to the trigger —
    // upward. The popover owns its own positioning, so the sheet must stay put. Real text inputs
    // carry none of these markers, so keyboard-avoidance for them is unaffected.
    if (active.closest('[aria-haspopup],[aria-expanded],[role=combobox]')) return

    // Walk up to the OUTERMOST overflow-y scroller inside the sheet (not the first) — that is always
    // the form body, which is what needs to scroll.
    let scrollEl: HTMLElement | null = null
    let el: HTMLElement | null = active.parentElement
    while (el !== null) {
      if (el.dataset['slot'] === 'sheet-content') break
      const oy = getComputedStyle(el).overflowY
      if (oy === 'auto' || oy === 'scroll') scrollEl = el
      el = el.parentElement
    }

    if (scrollEl === null) {
      active.scrollIntoView({ block: 'center' })
      return
    }

    const bodyRect = scrollEl.getBoundingClientRect()
    const activeRect = active.getBoundingClientRect()
    // The sheet rests directly on the keyboard, so the scroll body's bottom edge IS the keyboard's
    // top. Rest the focused field's BOTTOM just above it so the tapped field sits right on top of
    // the keyboard — not near the sheet's top.
    const gap = 12
    const fieldBottomInBody = scrollEl.scrollTop + activeRect.bottom - bodyRect.top
    let target = fieldBottomInBody + gap - scrollEl.clientHeight
    // If the field is taller than the visible area (a multi-line description), don't push its top
    // off the top edge — clamp so the field's top and its label stay in view.
    const fieldTopInBody = scrollEl.scrollTop + activeRect.top - bodyRect.top
    const labelRoom = 28
    if (target > fieldTopInBody - labelRoom) target = fieldTopInBody - labelRoom
    scrollEl.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
  }, [])

  // Re-centre once the keyboard inset settles — rAF lets the sheet finish resizing before we measure,
  // avoiding a no-op scroll against stale layout geometry.
  useEffect(() => {
    if (!keyboardOpen) return undefined
    const id = requestAnimationFrame(centerFocusedField)
    return (): void => {
      cancelAnimationFrame(id)
    }
  }, [keyboardOpen, centerFocusedField])

  // ...and immediately when focus moves between fields while the keyboard is already open.
  useEffect(() => {
    if (!open) return undefined
    const onFocusIn = (): void => {
      requestAnimationFrame(centerFocusedField)
    }
    document.addEventListener('focusin', onFocusIn)
    return (): void => {
      document.removeEventListener('focusin', onFocusIn)
    }
  }, [open, centerFocusedField])

  // Resizable mode: the sheet height is driven by the handle drag. Null means "use the default
  // height class" (before the first drag); a number pins an explicit pixel height.
  const [dragHeight, setDragHeight] = useState<number | null>(null)
  const dragHeightRef = useRef<number | null>(null)
  // Downward offset applied once the drag pushes below MIN_USABLE_PX: the sheet stops shrinking and
  // slides off-screen instead, so a release past DISMISS_OVERSHOOT_PX reads as a dismiss.
  const [dragShift, setDragShift] = useState(0)
  const dragShiftRef = useRef(0)
  // Disables the transition while actively dragging so the sheet tracks the finger; re-enabled on
  // release so the snap-back (and close) animate.
  const [resizing, setResizing] = useState(false)
  const resizingRef = useRef(false)
  const sheetElRef = useRef<HTMLElement | null>(null)
  const startYRef = useRef(0)
  const startHRef = useRef(0)

  const applyHeight = useCallback((value: number | null): void => {
    dragHeightRef.current = value
    setDragHeight(value)
  }, [])

  const applyShift = useCallback((value: number): void => {
    dragShiftRef.current = value
    setDragShift(value)
  }, [])

  // Reset the pinned height each time the sheet opens so every open starts from the default height
  // (resetting on close would jump the height mid close-animation).
  const handleSheetOpenChange = useCallback(
    (next: boolean): void => {
      if (next) {
        applyHeight(null)
        applyShift(0)
      }
      onOpenChange(next)
    },
    [onOpenChange, applyHeight, applyShift],
  )

  const handleResizeStart = useCallback((e: PointerEvent<HTMLDivElement>): void => {
    resizingRef.current = true
    setResizing(true)
    sheetElRef.current = e.currentTarget.closest<HTMLElement>('[data-slot=sheet-content]')
    startYRef.current = e.clientY
    startHRef.current = sheetElRef.current?.getBoundingClientRect().height ?? 0
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [])

  const handleResizeMove = useCallback(
    (e: PointerEvent<HTMLDivElement>): void => {
      if (!resizingRef.current) return
      // Dragging up (clientY decreases) grows the sheet. window.innerHeight is the only source of
      // the current viewport height during a pointer gesture.
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
    },
    [applyHeight, applyShift],
  )

  const handleResizeEnd = useCallback(
    (e: PointerEvent<HTMLDivElement>): void => {
      if (!resizingRef.current) return
      resizingRef.current = false
      setResizing(false)
      e.currentTarget.releasePointerCapture(e.pointerId)
      if (dragShiftRef.current > DISMISS_OVERSHOOT_PX) {
        // Clear the inline height/transform so the sheet's normal slide-out close animation runs.
        applyHeight(null)
        applyShift(0)
        onOpenChange(false)
      } else {
        // Snap back up to the minimum usable height (transition re-enabled now resizing is false).
        applyShift(0)
      }
    },
    [onOpenChange, applyHeight, applyShift],
  )

  // The form body inside `children` is the scroll container; scroll events don't bubble, so listen
  // in the capture phase to learn when it has moved off the top. Past a few px we collapse the
  // description and tighten the title so the header stops spending vertical space on context the
  // user has already read.
  const handleScrollCapture = useCallback((e: UIEvent<HTMLDivElement>): void => {
    const target = e.target
    if (target instanceof HTMLElement) setScrolled(target.scrollTop > 4)
  }, [])

  const resizeStyle: CSSProperties = {
    height: dragHeight === null ? undefined : `${String(dragHeight)}px`,
    transform: dragShift === 0 ? undefined : `translateY(${String(dragShift)}px)`,
    transition: resizing ? 'none' : undefined,
  }
  const sheetContentStyle: CSSProperties = {
    ...(resizable ? resizeStyle : dragStyle),
    ...keyboardStyle,
  }

  return (
    <Sheet open={open} onOpenChange={handleSheetOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        elevated={elevated}
        style={sheetContentStyle}
        onScrollCapture={handleScrollCapture}
        {...(resizable ? {} : handlers)}
        // Timing (duration + easing) is inherited from the shared SheetContent base so the bottom
        // sheet and the right-side drawer open/close at the same speed. Only layout is set here.
        // Rises to just below the app header (h-14 = 3.5rem). Slim horizontal padding so the form
        // body reclaims width on narrow screens.
        className={cn(
          'flex max-h-[calc(100dvh-3.5rem)] flex-col gap-0 rounded-t-2xl px-3 pt-2 pb-3',
          // Matches the sheet base's `data-[side=bottom]:h-auto` variant so tailwind-merge replaces
          // it — a plain `h-[60dvh]` wouldn't dedupe the variant and the sheet would hug its content.
          resizable && 'min-h-[200px] data-[side=bottom]:h-[60dvh]',
          className,
        )}
      >
        {resizable ? (
          <div
            onPointerDown={handleResizeStart}
            onPointerMove={handleResizeMove}
            onPointerUp={handleResizeEnd}
            onPointerCancel={handleResizeEnd}
            // An interactive drag handle that resizes the sheet, with a nested pill as its child.
            // <hr> is a void element — it can't hold that child — and its semantics don't cover a
            // draggable resize control.
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize sheet"
            // A tall, full-width grab zone (not just the thin pill) so a press slightly above or
            // below the pill still starts the drag — no pixel-perfect aim required. touch-none keeps
            // the browser from cancelling the gesture mid-drag.
            className="mx-auto -mt-3 flex h-11 w-full shrink-0 cursor-row-resize touch-none items-center justify-center"
          >
            <div
              className={cn(
                'h-1.5 w-10 rounded-full transition-colors',
                resizing ? 'bg-primary/70' : 'bg-foreground/20',
              )}
            />
          </div>
        ) : (
          // Swipe-down grab handle. The visible pill stays in normal flow; the actual press target
          // is the larger TRANSPARENT overlay, which overlaps the top of the header without pushing
          // it down. The swipe gesture itself lives on the whole SheetContent (see `handlers`), so
          // the press still drives the dismiss.
          <>
            <div
              aria-hidden="true"
              {...grip.handlers}
              className="absolute inset-x-0 top-0 z-10 h-20 touch-none"
            />
            <div
              aria-hidden="true"
              className="mx-auto mt-0.5 mb-1.5 flex h-5 w-full shrink-0 items-center justify-center"
            >
              <div
                className={cn(
                  'h-1.5 w-10 rounded-full transition-colors',
                  grip.pressed ? 'bg-primary/70' : 'bg-foreground/20',
                )}
              />
            </div>
          </>
        )}
        <div
          className={cn(
            'flex shrink-0 flex-col border-b border-border/50 transition-all duration-200',
            scrolled ? 'gap-0 pb-1.5' : 'gap-0.5 pb-2',
          )}
        >
          <SheetTitle className={cn('transition-all duration-200', scrolled && 'text-sm')}>
            {title}
          </SheetTitle>
          {description !== undefined && (
            // grid-rows 1fr→0fr collapses the description height smoothly; the inner p must clip.
            <div
              className={cn(
                'grid transition-all duration-200',
                scrolled ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100',
              )}
            >
              <p className="overflow-hidden text-xs text-muted-foreground">{description}</p>
            </div>
          )}
        </div>
        {children(scrolled)}
      </SheetContent>
    </Sheet>
  )
}
