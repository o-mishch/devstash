'use client'

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { motion, useReducedMotion, type Transition } from 'motion/react'

// Open/close slide timing. Easing mirrors the old Sheet shell's cubic-bezier.
const SLIDE: Transition = { duration: 0.32, ease: [0.32, 0.72, 0, 1] }

type Phase = 'idle' | 'sliding' | 'settled'

interface MobileItemPaneSliderProps {
  // Screen 1 — the live app page (list/dashboard). Mounted ONCE inside a single persistent wrapper whose
  // className is toggled (document flow ⇄ fixed backdrop). `page` never changes tree position or parent
  // element TYPE, so React never remounts it — its DOM, scroll, and virtualized-list state all persist.
  // Pass null when there is no page backdrop (e.g. the draft drawer: the parse board is already visible
  // under the overlay without a managed backdrop layer). The pageLayer is skipped entirely in that case.
  page: ReactNode | null
  open: boolean
  // Window scroll position captured (in the store) at the open click. The page is kept mounted, but the
  // document-level window scroll is pinned to 0 while the item is up — so it's restored from this on close
  // (React preserves component state via stable tree position, not the browser's document scroll value).
  openScrollY: number
  /**
   * Renders the full-screen pane content. Receives `isSettled` (true once the open slide finishes and the
   * pane IS the document scroller) and `onSwipeCloseStart` (call synchronously when a swipe has already
   * animated the pane off-screen so the slider skips its own reverse slide). The callback is `undefined`
   * while the pane is still sliding in (not yet settled) — the implementor must disable swipe-to-close
   * until it is provided.
   */
  renderPane: (props: { isSettled: boolean; onSwipeCloseStart?: () => void }) => ReactNode
}

// Touch-only mobile shell. The app page is kept PERMANENTLY MOUNTED so opening an item never destroys it.
//
// React resets a subtree's state when it moves position or its parent element type changes (React docs:
// "State is tied to a position in the render tree"). So `page` is rendered in exactly one persistent
// `<div>` wrapper for the whole lifetime — only that div's CSS class toggles between roles. The item is a
// separate overlay layered on top. Three states drive how the two relate:
//
//  • idle    — closed. The page wrapper is plain document flow (window scrolls it → the mobile URL bar
//              retracts on the list). No item.
//  • sliding — mid open/close transition. The page wrapper becomes a fixed backdrop (still painted) while
//              the item rides in/out as a fixed overlay translating over it — BOTH visible.
//  • settled — open finished. The item is the sole DOCUMENT content (URL bar retracts on it). The page
//              stays in its wrapper as a fixed backdrop behind the opaque item, fully occluded but still
//              painted, so a swipe-right reveals it instantly through the gap with no re-mount.
//
// Mount preservation comes from the STABLE wrapper position alone: the wrapper stays a `<div>` in every
// state, so `page` never changes parent type and is never remounted.
export function MobileItemPaneSlider({ page, open, openScrollY, renderPane }: MobileItemPaneSliderProps) {
  const reduceMotion = useReducedMotion()
  const transition = reduceMotion ? { duration: 0 } : SLIDE

  // A swipe-close has ALREADY animated the item off-screen via the drag's own `x`, so it must NOT trigger the
  // slider's reverse slide — that would re-render the item at x:0% (fully open) and slide it off again (the
  // visible "jump"). `setSwipeClosing(true)` is called synchronously in the SAME tick as the guarded close
  // commit (see commitSwipeClose in ItemFullScreenView). On a clean close React flushes `swipeClosing=true`
  // together with `open=false`, and the close-direction guard reads it to go straight to idle. On a DIRTY
  // close the guard defers: the item springs back to x:0 while the discard dialog shows; when the user
  // confirms, `open` becomes false, the flag is consumed (→ idle, no reverse slide), then reset.
  const [swipeClosing, setSwipeClosing] = useState(false)

  // Ref for the live `open` value, read inside onAnimationComplete to avoid a stale closure. Motion fires
  // the callback with the function registered at animation-start time; on a rapid open→close OR a rapid
  // close→open (re-open while a close slide is still running) the callback would read the wrong `open` and
  // land on the wrong terminal phase. useLayoutEffect keeps the ref current before any animation callback
  // fires — so a rapid reopen during a close slide reads `open=true` and correctly settles on 'settled',
  // with no extra phase-guard needed. Updated via useLayoutEffect (not during render) to avoid writing a
  // ref during the render phase.
  const openRef = useRef(open)
  useLayoutEffect(() => { openRef.current = open })

  // Phase, derived from `open` during render. The slide's onAnimationComplete advances sliding→settled
  // (open) / sliding→idle (close). Reduced motion has no slide to wait on (duration 0 may never fire
  // onAnimationComplete), so it skips the `sliding` phase entirely and lands on the terminal phase.
  const [phase, setPhase] = useState<Phase>(open ? 'settled' : 'idle')
  // Calling setState during render is valid when the new value derives purely from existing
  // state/props with no side effects (React docs §bailout-on-re-rendering). Each condition here is
  // independent with no cross-condition stale read — React batches the results into one extra render.
  if (open && phase === 'idle') setPhase(reduceMotion ? 'settled' : 'sliding')
  if (!open && phase === 'settled') {
    setPhase(reduceMotion || swipeClosing ? 'idle' : 'sliding')
  }
  if (phase === 'idle' && swipeClosing) setSwipeClosing(false)

  const pageIsDocument = phase === 'idle'

  // Restore the page's window scroll as soon as the item starts LEAVING via a slide-close (Cancel / X), not
  // only once it's fully idle. During that close slide the item is a `fixed inset-0` overlay (see `pane`)
  // covering the viewport, so the document underneath can be scrolled back to openScrollY without a visible
  // jump — then the handoff to document flow is seamless. Waiting for `idle` left the window pinned at 0 for
  // the whole close slide and then jumped 0→openScrollY at the handoff — the visible "minor movement" of the
  // base page. (Swipe-close is unaffected here: there the board is revealed through the flown-off panel via the
  // fixed backdrop's transform offset, already at openScrollY, so it never shows the top.) Opening (sliding with
  // open=true) and settled still pin to 0 so the item shows from its header.
  const itemIsLeaving = phase === 'sliding' && !open
  const restorePageScroll = pageIsDocument || itemIsLeaving

  // While the item is up (opening / settled), pin the window to the top so the item shows from its header.
  // The page DOM is preserved by the stable wrapper, but the document-level window scroll is not React state,
  // so we re-assert it here. The list virtualizes/grows over a few frames, so a single scrollTo can land short
  // — retry over a few rAFs until it sticks; a no-op once it already matches.
  useLayoutEffect(() => {
    if (page === null) return
    if (!restorePageScroll) {
      // window.scrollTo: document-level scroll has no React/Next equivalent. behavior:'instant' is REQUIRED:
      // <html> carries `scroll-smooth` (globals), so a plain scrollTo here would animate the pin-to-0.
      window.scrollTo({ top: 0, behavior: 'instant' })
      return
    }
    // window.scrollTo: document-level scroll has no React/Next equivalent.
    if (openScrollY <= 0 || Math.abs(window.scrollY - openScrollY) <= 1) return
    let tries = 0
    let raf = 0
    // `cancelled` guards stale rAF callbacks that fire after cleanup. `raf` holds the single pending
    // frame handle; the chain is linear (each callback either returns or schedules exactly one more frame),
    // so cancelAnimationFrame(raf) covers the one pending frame — but the flag handles the edge case
    // where cleanup runs between the rAF firing and the callback reading `raf`.
    let cancelled = false
    const restore = () => {
      if (cancelled) return
      // Re-measure on every frame: the virtualizer may still be growing the page (on close the document
      // can sit at ~viewport height for a few hundred ms before the list re-grows to full height), so
      // maxScroll from frame 1 could be stale by frame 5. Keep scrolling to as far as possible each frame
      // until the content is tall enough to reach openScrollY, then settle precisely.
      //
      // behavior:'instant' on EVERY scrollTo is essential: <html> has `scroll-smooth` (globals.css), so a
      // default scrollTo would SMOOTH-animate each step — the restore would visibly ramp the page from the
      // top down to openScrollY over ~800ms (the reported "flashes at top, then scrolls down to position").
      // Instant makes each correction jump, so once the page is tall enough it lands in a single frame.
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight
      if (openScrollY > maxScroll) {
        // Page not tall enough yet — scroll to the current bottom and keep retrying.
        window.scrollTo({ top: maxScroll, behavior: 'instant' })
        tries += 1
        if (tries < 40) raf = requestAnimationFrame(restore)
        return
      }
      window.scrollTo({ top: openScrollY, behavior: 'instant' })
      tries += 1
      // 40 frames (~667 ms at 60 fps) to allow for slow virtualizer re-measurement on low-end devices.
      if (Math.abs(window.scrollY - openScrollY) > 1 && tries < 40) raf = requestAnimationFrame(restore)
    }
    restore()
    return () => { cancelled = true; cancelAnimationFrame(raf) }
  }, [page, restorePageScroll, openScrollY])

  // During the CLOSING slide the page returns to document flow (`contents`) even though the item is still
  // sliding off over it — see `pageActsAsDocument`. The window-scroll restore (above) needs the document at
  // full height to reach openScrollY, which only `contents` provides; the still-covering item overlay hides
  // the swap. So the fixed-backdrop scrollTop positioning is only needed while OPENING/settled, not closing.
  const pageActsAsDocument = pageIsDocument || itemIsLeaving

  const settled = phase === 'settled'

  // The page — mounted ONCE in this persistent two-div wrapper. The OUTER and INNER divs ALWAYS render (same
  // nesting in every phase), so `page` keeps a stable tree position and React never remounts it; only the divs'
  // CSS classes/style toggle between roles. Changing the nesting depth instead (e.g. one wrapper vs two) would
  // move `page` and destroy + recreate its subtree — the very thing this shell exists to avoid.
  //  • document mode (`pageActsAsDocument`: idle, AND the closing slide where the window scroll carries
  //    openScrollY and the still-covering item hides the swap) — both divs are `contents` (transparent to
  //    layout), so the page is the normal document scroller.
  //  • fixed backdrop (opening / settled) — the outer div is a `fixed inset-0 -z-10 overflow-hidden` clip and
  //    the inner div is shifted up by `translateY(-openScrollY)` so the saved scroll position shows through a
  //    swipe gap. A CSS transform (NOT scrollTop) is essential: iOS Safari does not reliably honour `scrollTop`
  //    on a `position: fixed` overflow container — during the swipe fly-off it reset the backdrop to the top, so
  //    the revealed board flashed its header. A transform is GPU-composited and behaves identically everywhere.
  // When `page` is null there is no managed backdrop; the pageLayer is omitted entirely.
  const pageLayer = page !== null ? (
    <div className={pageActsAsDocument ? 'contents' : 'fixed inset-0 -z-10 w-screen overflow-hidden'}>
      <div
        className={pageActsAsDocument ? 'contents' : undefined}
        style={pageActsAsDocument ? undefined : { transform: `translateY(${-openScrollY}px)` }}
      >
        {page}
      </div>
    </div>
  ) : null

  // Always return a Fragment so `pageLayer` (and its `page` subtree) stays at a stable tree position across
  // all phases. The motion.div is conditionally rendered at position 1 — only it mounts/unmounts as the item
  // opens and closes. ItemFullScreenView stays in ONE persistent slot inside the motion.div across `sliding`
  // and `settled` — its swipe drag state and scroll-reset effect survive the open animation's completion.
  //  • sliding — a fixed z-40 overlay translating in/out over the still-visible page backdrop.
  //  • settled (page mode) — the item is the sole DOCUMENT content (URL bar retracts). The page sits behind.
  //  • settled (noPage mode) — stays fixed inset-0 z-40 throughout (no backdrop to swap into document flow).
  const noPageMode = page === null
  const pane = !pageIsDocument ? (
    <motion.div
      className={settled && !noPageMode ? '' : 'fixed inset-0 z-40 overflow-y-auto'}
      initial={settled ? false : { x: open ? '100%' : '0%' }}
      animate={settled ? { x: '0%' } : { x: open ? '0%' : '100%' }}
      transition={transition}
      onAnimationComplete={reduceMotion ? undefined : () => setPhase(openRef.current ? 'settled' : 'idle')}
    >
      {renderPane({
        isSettled: settled,
        onSwipeCloseStart: settled ? () => setSwipeClosing(true) : undefined,
      })}
    </motion.div>
  ) : null

  return (
    <>
      {pageLayer}
      {pane}
    </>
  )
}
