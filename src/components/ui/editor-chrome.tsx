'use client'

import { useRef, useState, useEffect, useLayoutEffect, useCallback, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { motion, useMotionValue, animate } from 'motion/react'
import { Maximize2, Minimize2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useVisualViewport } from '@/hooks/ui/use-visual-viewport'
import { useEditorHeaderDrag } from '@/hooks/editor/use-editor-header-drag'
import { useIsTouch } from '@/hooks/ui/use-is-touch'
import { useEditorFullscreenStore } from '@/stores/editor-fullscreen'

// Past this downward drag (or a faster flick) the maximized editor collapses; below it the window
// snaps back to full screen.
const COLLAPSE_DRAG_PX = 90
const COLLAPSE_FLICK_VELOCITY = 0.5 // px per ms

// Spring used for both expand and collapse transitions.
const EXPAND_SPRING = { type: 'spring' as const, bounce: 0.08, duration: 0.5 }

interface ClipRect {
  top: number
  right: number
  bottom: number
  left: number
}

// Walk up from the sentinel collecting every ancestor that clips overflow (the form's scroll
// container, the dialog/sheet body, etc). The collapsed touch overlay is a position:fixed portal on
// document.body that deliberately escaped these ancestors' clipping (to dodge transformed dialog /
// drawer ancestors) — so when the body scrolls or the keyboard reflows the form, the floating editor
// paints over the header/footer. Re-applying the combined ancestor bounds as a clip-path restores
// the natural clipping the portal gave up.
function getClippingAncestors(el: HTMLElement): HTMLElement[] {
  const result: HTMLElement[] = []
  let node = el.parentElement
  while (node && node !== document.body && node !== document.documentElement) {
    const style = getComputedStyle(node)
    if (style.overflowX !== 'visible' || style.overflowY !== 'visible') result.push(node)
    node = node.parentElement
  }
  return result
}

// The mobile full-screen item drawer scrolls the document, so it has no overflow-clipping ancestor for
// the walk above to find — yet it pins a sticky header (marked `data-drawer-sticky-header`) the portaled
// overlay must still clip below. Walk up to the drawer container that holds that header and return it, so
// its bottom edge can clamp the overlay's clip top. Returns null on every other surface.
function getDrawerStickyHeader(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement
  while (node && node !== document.body && node !== document.documentElement) {
    const header = node.querySelector<HTMLElement>(':scope > [data-drawer-sticky-header]')
    if (header) return header
    node = node.parentElement
  }
  return null
}

// Shared className for the copy button in editor chrome headers. The `touch:size-5` cancels the
// Button variant's `touch:size-11` tap-target upsize so the chrome bar stays compact on mobile.
export const EDITOR_CHROME_COPY_BUTTON_CLASS =
  'size-5 touch:size-5 text-muted-foreground hover:text-white hover:bg-white/10'

interface EditorChromeHeaderProps {
  children: ReactNode
  className?: string
  // Traffic-light dot actions. When undefined the dot is dimmed and inert.
  onCollapse?: () => void
  onExpand?: () => void
  dragHandlers?: ReturnType<typeof useEditorHeaderDrag>
}

// The dark title bar atop every editor/viewer surface: macOS-style traffic-light dots on the
// left, caller-supplied controls (copy button, language pill, write/preview tabs) on the right.
function EditorChromeHeader({ children, className, onCollapse, onExpand, dragHandlers }: EditorChromeHeaderProps) {
  return (
    // Tap/click-without-drag on this header bar triggers the exact same collapse/expand action as the
    // adjacent traffic-light buttons below (real <button>s with their own aria-labels, driven by the
    // same onCollapse/onExpand callbacks) — this is a mouse/touch-only convenience gesture layered on
    // top of an already fully keyboard-accessible equivalent, so it needs no keyboard handling of its
    // own.
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className={cn('flex items-center justify-between px-3 py-0.5 border-b border-white/10 bg-[#2D2D2D] shrink-0', className)}
      onTouchStart={dragHandlers?.onTouchStart}
      onTouchMove={dragHandlers?.onTouchMove}
      onTouchEnd={dragHandlers?.onTouchEnd}
      onTouchCancel={dragHandlers?.onTouchCancel}
      onMouseDown={dragHandlers?.onMouseDown}
      onClick={dragHandlers?.onClick}
    >
      <div className="flex gap-1.5 items-center">
        <button
          type="button"
          aria-label="Collapse editor"
          onClick={onCollapse}
          disabled={!onCollapse}
          className="size-2.5 rounded-full bg-[#FF5F56] disabled:opacity-30"
        />
        <button
          type="button"
          aria-label="Minimize editor"
          onClick={onCollapse}
          disabled={!onCollapse}
          className="size-2.5 rounded-full bg-[#FFBD2E] disabled:opacity-30"
        />
        <button
          type="button"
          aria-label="Expand editor"
          onClick={onExpand}
          disabled={!onExpand}
          className="size-2.5 rounded-full bg-[#27C93F] disabled:opacity-30"
        />
      </div>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  )
}

interface EditorChromeShellProps {
  header: ReactNode
  children: ReactNode
  className?: string
  style?: CSSProperties
  // When set, a maximize/restore toggle is rendered in the chrome header (aligned with the copy
  // button) and the surface can expand to fill the viewport. The string is the accessible label
  // target, e.g. "code editor" → "Enter full screen code editor". Omit to disable the toggle.
  fullscreenLabel?: string
  // When provided, callers call this to trigger fullscreen expand from outside (e.g. the markdown
  // "show keyboard" button re-focuses the textarea and expands in one gesture).
  expandRef?: { current: (() => void) | null }
  // When provided, callers read whether the shell is already fullscreen (e.g. to skip re-expand).
  fullscreenRef?: { current: boolean }
}

// The full editor/viewer surface: the rounded dark bordered shell + the traffic-light header bar
// + caller content.
//
// KEY DESIGN — children render exactly once, always inside a single portal on document.body, and
// are never unmounted or reparented. The portal animates between two positions:
//   - Collapsed: positioned/sized to match an invisible sentinel <div> in the normal document flow.
//   - Fullscreen: positioned/sized to the visual viewport (keyboard-aware via visualViewport).
//
// Reparenting a React subtree (inline ⇄ portal, or portal target A ⇄ B) always remounts the DOM
// node, which blurs any focused textarea/Monaco input and dismisses the on-screen keyboard. By
// keeping the node in one stable container, focus survives the expand/collapse transition: a tap
// focuses the field (keyboard shows) and the size animation never blurs it (keyboard stays).
//
// Portalling to document.body also escapes any ancestor CSS transform (Radix dialog / vaul drawer),
// which would otherwise make `position: fixed` size against the transformed ancestor, not the
// viewport.
//
// On touch devices, when a fullscreenLabel is set, tapping anywhere in the content area expands to
// fullscreen — editable editors keep their natural tap-focus (keyboard up), readonly viewers have
// no focusable field so no keyboard appears.
export function EditorChromeShell({ header, children, className, style, fullscreenLabel, expandRef, fullscreenRef }: EditorChromeShellProps) {
  const [fullscreen, setFullscreen] = useState(false)
  const viewport = useVisualViewport()
  const isTouch = useIsTouch()
  const enterEditorFullscreen = useEditorFullscreenStore((s) => s.enter)
  const exitEditorFullscreen = useEditorFullscreenStore((s) => s.exit)

  // Spring the expand/collapse morph, but follow scroll/drag/keyboard instantly. `morphing` is on
  // only for the brief expand or collapse transition; every other geometry change (page scroll
  // tracking the sentinel, drag offset, keyboard resize) must apply with no spring or it visibly
  // lags behind the finger/scroll.
  const [morphing, setMorphing] = useState(false)
  const morphTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The always-portal (never-remount) path exists to keep the on-screen keyboard up on touch.
  // Desktop has no on-screen keyboard, so there it portals when fullscreen (plus the brief collapse
  // morph, via `morphing`) and otherwise renders inline — where the dialog's overflow clips it and
  // the footer sits below it, instead of a fixed z-50 overlay painting over the footer.
  const portaled = fullscreen || isTouch || morphing

  // Sentinel: an invisible placeholder that holds space in the normal document flow. The portal
  // reads its bounding rect to position/size itself on top of it while collapsed.
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [sentinelRect, setSentinelRect] = useState<DOMRect | null>(null)

  // Inline wrapper (the desktop collapsed box). Its rect is captured on expand and seeded into the
  // motion values (in changeFullscreen) so the portal morphs out of — and back into — the exact
  // editor box rather than snapping to/from fullscreen.
  const inlineRef = useRef<HTMLDivElement>(null)

  // Combined bounds of the sentinel's overflow-clipping ancestors, used to clip the collapsed touch
  // overlay so it never paints over the form header/footer when the body scrolls. The ancestor list
  // is stable while mounted, so it's computed once (lazily) and only the rects are re-read per frame.
  const clipAncestorsRef = useRef<HTMLElement[] | null>(null)
  // The mobile full-screen drawer's pinned sticky header (when this editor lives inside one). Cached
  // alongside the clip ancestors and reset on cleanup; used to clamp the overlay's clip top below it.
  const stickyHeaderRef = useRef<HTMLElement | null>(null)
  const [clipRect, setClipRect] = useState<ClipRect | null>(null)

  // Live visible-viewport bottom (the keyboard top, in client coords) so the per-frame clip callback
  // can read it without the viewport being a dependency. When the on-screen keyboard opens, the
  // collapsed editor's portal — sized to its (tall) sentinel — would otherwise extend its bottom
  // edge DOWN past the keyboard top, painting over both the keyboard and any field the host scrolled
  // up to sit just above it. Clamping the clip bottom here keeps the editor strictly inside the
  // visible area above the keyboard. 0 (no inset) when no keyboard is shown.
  const keyboardTopRef = useRef(0)
  useLayoutEffect(() => {
    keyboardTopRef.current = viewport && viewport.keyboardHeight > 0 ? viewport.visibleBottom : 0
  }, [viewport])

  // Geometry is driven by motion values, NOT React state + Motion's declarative `animate`, so the
  // collapsed overlay can be positioned imperatively each frame (see the tracking effect) with zero
  // lag — the same imperative-mirror technique the drawer's grab-handle rail uses. Routing the rect
  // through setState → Motion's own frame loop landed a frame late, so the editor visibly trailed
  // ("floated") behind the drawer as it slid/dragged. Motion still springs these during the morph.
  const mvLeft = useMotionValue(0)
  const mvTop = useMotionValue(0)
  const mvWidth = useMotionValue(0)
  const mvHeight = useMotionValue(0)
  const mvPadding = useMotionValue(0)

  const changeFullscreen = useCallback((next: boolean) => {
    // Capture the geometry to morph between so the portal grows out of — and shrinks back into — the
    // collapsed editor box (desktop). Expanding reads the inline wrapper (the only collapsed mount
    // on desktop); collapsing reads the sentinel under the overlay, so the collapsed target is valid
    // on the first frame instead of snapping to the corner.
    if (next) {
      if (inlineRef.current) {
        const rect = inlineRef.current.getBoundingClientRect()
        // Seed the motion values at the collapsed inline box so the expand springs out of it
        // (desktop). On touch they're already at the sentinel rect from the tracking effect.
        mvLeft.set(rect.left)
        mvTop.set(rect.top)
        mvWidth.set(rect.width)
        mvHeight.set(rect.height)
        mvPadding.set(0)
      }
    } else if (sentinelRef.current) {
      setSentinelRect(sentinelRef.current.getBoundingClientRect())
    }
    setMorphing(true)
    if (morphTimer.current) clearTimeout(morphTimer.current)
    morphTimer.current = setTimeout(() => setMorphing(false), 550)
    setFullscreen(next)
  }, [mvLeft, mvTop, mvWidth, mvHeight, mvPadding])

  useEffect(() => () => { if (morphTimer.current) clearTimeout(morphTimer.current) }, [])

  const updateSentinelRect = useCallback(() => {
    const el = sentinelRef.current
    if (!el) return false
    const rect = el.getBoundingClientRect()
    // Only re-render when the rect actually moved/resized, so the rAF loop below stays free.
    // Report back whether it changed so the loop can gate the (heavier) clip recompute on it.
    let changed = false
    setSentinelRect((prev) => {
      if (prev && prev.left === rect.left && prev.top === rect.top && prev.width === rect.width && prev.height === rect.height) {
        return prev
      }
      changed = true
      return rect
    })
    return changed
  }, [])

  const updateClipRect = useCallback(() => {
    const el = sentinelRef.current
    if (!el) return
    if (!clipAncestorsRef.current) {
      clipAncestorsRef.current = getClippingAncestors(el)
      // Resolve the enclosing drawer's sticky header once (the sentinel's drawer ancestor, if any).
      stickyHeaderRef.current = getDrawerStickyHeader(el)
    }
    const ancestors = clipAncestorsRef.current
    // The mobile full-screen item drawer scrolls the DOCUMENT, so it has no overflow-clipping ancestor —
    // but it pins a sticky header the overlay must still clip below. Its content area (this sentinel's
    // enclosing flow) is a sibling of that header; reach back up to the shared drawer container and grab
    // the header, so its bottom can clamp `top` even when `ancestors` is empty (otherwise the overlay
    // slides up over the header as the page scrolls). Null on every other surface — a plain no-op there.
    const stickyHeader = stickyHeaderRef.current
    const keyboardTop = keyboardTopRef.current
    if (ancestors.length === 0 && !stickyHeader && keyboardTop <= 0) {
      setClipRect((prev) => (prev === null ? prev : null))
      return
    }
    // Intersection of every clipping ancestor's rect: the visible region the overlay may paint in.
    let top = -Infinity
    let left = -Infinity
    let right = Infinity
    let bottom = Infinity
    ancestors.forEach((ancestor) => {
      const r = ancestor.getBoundingClientRect()
      if (r.top > top) top = r.top
      if (r.left > left) left = r.left
      if (r.right < right) right = r.right
      if (r.bottom < bottom) bottom = r.bottom
    })
    // Clamp the top to the drawer's sticky header bottom: the portal must never paint over the pinned
    // header. (No-op on surfaces without one — stickyHeader is null there.)
    if (stickyHeader) {
      const hb = stickyHeader.getBoundingClientRect().bottom
      if (hb > top) top = hb
    }
    // Clamp the bottom to the on-screen keyboard top so the editor never paints over the keyboard or
    // over a field the host has scrolled up to rest just above it. (No-op when no keyboard is shown.)
    if (keyboardTop > 0 && keyboardTop < bottom) {
      bottom = keyboardTop
    }
    setClipRect((prev) =>
      prev && prev.top === top && prev.left === left && prev.right === right && prev.bottom === bottom
        ? prev
        : { top, left, right, bottom },
    )
  }, [])

  // Track the sentinel each animation frame while collapsed so the overlay follows every layout
  // change — including ancestor transform animations (drawer open) and drag, which emit no scroll
  // or resize events. getBoundingClientRect is cheap for one element and we setState only on real
  // movement, so this re-renders only when the geometry truly changes. Idle while fullscreen, where
  // the visual viewport drives the geometry instead.
  useEffect(() => {
    // Track the sentinel each frame whenever the portal is anchored to it (collapsed): the touch
    // collapsed overlay at rest, and the brief desktop collapse morph. Idle while fullscreen (the
    // visual viewport drives geometry) and while collapsed inline on desktop (no portal/sentinel).
    if (fullscreen || !portaled || morphing) return
    // Write the overlay's geometry straight to its motion values from the sentinel rect — same frame,
    // no setState/Motion round-trip — so the collapsed editor never trails the drawer's transform as
    // it slides or is swipe-dragged. (Idle during the morph, where the effect below springs them.)
    const writeLive = () => {
      const el = sentinelRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      mvLeft.set(r.left)
      mvTop.set(r.top)
      mvWidth.set(r.width)
      mvHeight.set(r.height)
    }
    writeLive()
    // Measure once up front so a collapsed overlay clips correctly even if it never moves again.
    updateSentinelRect()
    updateClipRect()
    let raf = 0
    const tick = () => {
      writeLive()
      // Recompute the sentinel AND the clip together every frame. Gating the clip behind sentinel
      // movement desynced them across the host sheet's open animation: the clip got computed against
      // mid-animation ancestor rects, then — once the sheet settled and the sentinel stopped moving —
      // was never recomputed, so a stale `insetTop` hid the collapsed editor until a stray scroll
      // nudged the sentinel. Reading both in the same frame keeps the clip converged to the settled
      // geometry; the setState guards below suppress re-renders, so the only added cost is 1–3
      // ancestor getBoundingClientRect reads on a loop that already measures the sentinel each frame.
      updateSentinelRect()
      updateClipRect()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      clipAncestorsRef.current = null
      stickyHeaderRef.current = null
      setClipRect(null)
    }
  }, [fullscreen, portaled, morphing, updateSentinelRect, updateClipRect, mvLeft, mvTop, mvWidth, mvHeight])

  // Drag-down-to-collapse: grabbing the chrome header and pulling down slides the maximized window
  // with the finger and collapses it on release (past a threshold or a flick).
  const [dragY, setDragY] = useState(0)

  const collapseDrag = useEditorHeaderDrag({
    active: fullscreen,
    direction: 'down',
    thresholdPx: COLLAPSE_DRAG_PX,
    flickVelocity: COLLAPSE_FLICK_VELOCITY,
    onTrigger: () => changeFullscreen(false),
    onClickWithoutDrag: () => changeFullscreen(false),
    onDragOffset: setDragY,
  })

  const expandDrag = useEditorHeaderDrag({
    active: !fullscreen && Boolean(fullscreenLabel),
    direction: 'up',
    thresholdPx: COLLAPSE_DRAG_PX,
    flickVelocity: COLLAPSE_FLICK_VELOCITY,
    onTrigger: () => changeFullscreen(true),
    onClickWithoutDrag: () => changeFullscreen(true),
  })

  const toggleFullscreen = () => {
    setDragY(0)
    changeFullscreen(!fullscreen)
  }

  useLayoutEffect(() => {
    if (!expandRef) return
    expandRef.current = fullscreenLabel ? () => changeFullscreen(true) : null
    return () => { expandRef.current = null }
  }, [expandRef, fullscreenLabel, changeFullscreen])

  useLayoutEffect(() => {
    if (!fullscreenRef) return
    fullscreenRef.current = fullscreen
  }, [fullscreenRef, fullscreen])

  // Publish fullscreen state so a surrounding item drawer can disable swipe-to-dismiss while the
  // editor is maximized (only fullscreen-capable editors participate). Reference-counted: enter while
  // this editor is fullscreen, and the cleanup exits both when it collapses (fullscreen → false) and
  // when it unmounts — so the flag is always balanced and never stays stuck true.
  useEffect(() => {
    if (!fullscreenLabel || !fullscreen) return
    enterEditorFullscreen()
    return () => exitEditorFullscreen()
  }, [fullscreenLabel, fullscreen, enterEditorFullscreen, exitEditorFullscreen])

  useEffect(() => {
    if (!fullscreen) return
    // Capture-phase so Esc collapses the editor before a surrounding Dialog can close.
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      changeFullscreen(false)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [fullscreen, changeFullscreen])

  const fullscreenToggle = fullscreenLabel ? (
    <button
      type="button"
      aria-pressed={fullscreen}
      aria-label={fullscreen ? `Exit full screen ${fullscreenLabel}` : `Enter full screen ${fullscreenLabel}`}
      onClick={toggleFullscreen}
      className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-white/10 hover:text-white"
    >
      {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
    </button>
  ) : null

  let headerDragHandlers: ReturnType<typeof useEditorHeaderDrag> | undefined
  if (fullscreen) headerDragHandlers = collapseDrag
  else if (fullscreenLabel) headerDragHandlers = expandDrag

  // Tap-anywhere-to-expand on touch. The `display: contents` wrapper is rendered unconditionally
  // (only its handler toggles) so it never changes `children`'s parent — reparenting would remount
  // the textarea/Monaco node, blurring it and dismissing the keyboard. `display: contents` adds no
  // box, so it never disturbs the editor's flex layout, yet still receives the bubbled pointerdown.
  // We don't preventDefault, so an editable field keeps its natural focus and the keyboard stays up.
  const tapToExpand = Boolean(fullscreenLabel) && isTouch && !fullscreen
  const content = (
    <div
      className="contents"
      onPointerDown={tapToExpand ? (e) => {
        if (e.pointerType === 'mouse') return
        changeFullscreen(true)
      } : undefined}
    >
      {children}
    </div>
  )

  const shellContent = (
    <>
      <EditorChromeHeader
        className={cn(
          fullscreenLabel ? 'touch-none cursor-grab active:cursor-grabbing select-none' : undefined,
          fullscreen ? 'touch:py-3' : undefined,
        )}
        onCollapse={fullscreen ? () => changeFullscreen(false) : undefined}
        onExpand={!fullscreen && fullscreenLabel ? toggleFullscreen : undefined}
        dragHandlers={headerDragHandlers}
      >
        {header}
        {fullscreenToggle}
      </EditorChromeHeader>
      {content}
    </>
  )

  // No `className` here on purpose: the caller's sizing class (h-64, flex-1, min-h-…) defines the
  // collapsed footprint and lives on the sentinel below. The shell always fills its portal box
  // (h-full) so it covers the full viewport in fullscreen instead of inheriting the collapsed size.
  const shellInnerClassName =
    'flex flex-col flex-1 min-h-0 rounded-lg border text-card-foreground shadow-sm overflow-hidden ring-1 ring-white/10 ring-inset h-full'

  // Target geometry for the portal. Collapsed: cover the sentinel exactly (looks identical to
  // inline). Fullscreen: cover the visual viewport, with dragY folded in for drag-to-collapse.
  let overlayLeft = 0
  let overlayTop = 0
  let overlayWidth = 0
  let overlayHeight = 0

  if (fullscreen) {
    if (viewport) {
      overlayLeft = viewport.offsetLeft
      overlayTop = viewport.offsetTop + dragY
      overlayWidth = viewport.width
      overlayHeight = viewport.height
    } else {
      // No visualViewport API (rare legacy browsers): fall back to the layout viewport. Read it in
      // px — not '100dvw'/'100dvh' strings — so Motion interpolates the morph from the sentinel's
      // pixel rect instead of snapping across a number→unit-string boundary. documentElement client
      // size is the only way to read the layout viewport here; this branch runs client-only (portal).
      overlayTop = dragY
      overlayWidth = document.documentElement.clientWidth
      overlayHeight = document.documentElement.clientHeight
    }
  } else if (sentinelRect) {
    overlayLeft = sentinelRect.left
    overlayTop = sentinelRect.top
    overlayWidth = sentinelRect.width
    overlayHeight = sentinelRect.height
  }

  // Collapsed touch overlay: clip the fixed portal to its scroll container's bounds so it never
  // paints over (or intercepts taps on) the form header/footer when the body scrolls or the keyboard
  // reflows the form. Only applied at rest (collapsed, not mid-morph) where the transition is instant
  // and the overlay geometry equals the sentinel rect, so the clip insets match the rendered box.
  // Fullscreen intentionally covers everything, so it is never clipped.
  let clipPath: string | undefined
  if (portaled && !fullscreen && !morphing && clipRect) {
    const insetTop = Math.max(0, clipRect.top - overlayTop)
    const insetRight = Math.max(0, overlayLeft + overlayWidth - clipRect.right)
    const insetBottom = Math.max(0, overlayTop + overlayHeight - clipRect.bottom)
    const insetLeft = Math.max(0, clipRect.left - overlayLeft)
    clipPath = `inset(${insetTop}px ${insetRight}px ${insetBottom}px ${insetLeft}px)`
  }

  // Morph (expand/collapse) springs the motion values to the target; fullscreen-at-rest (keyboard /
  // viewport resize, drag-to-collapse offset) snaps them. Idle while collapsed-tracking (the rAF
  // effect above owns the values then, lag-free) and while inline (no overlay).
  useEffect(() => {
    if (!portaled || (!fullscreen && !morphing)) return
    const padTarget = fullscreen ? 12 : 0
    if (morphing) {
      // Stop the springs on cleanup so a re-fire (target change) or unmount mid-morph never leaves
      // an orphaned animation writing to a motion value after the effect re-runs.
      const controls = [
        animate(mvLeft, overlayLeft, EXPAND_SPRING),
        animate(mvTop, overlayTop, EXPAND_SPRING),
        animate(mvWidth, overlayWidth, EXPAND_SPRING),
        animate(mvHeight, overlayHeight, EXPAND_SPRING),
        animate(mvPadding, padTarget, EXPAND_SPRING),
      ]
      return () => controls.forEach((c) => c.stop())
    } else {
      mvLeft.set(overlayLeft)
      mvTop.set(overlayTop)
      mvWidth.set(overlayWidth)
      mvHeight.set(overlayHeight)
      mvPadding.set(padTarget)
    }
  }, [portaled, fullscreen, morphing, overlayLeft, overlayTop, overlayWidth, overlayHeight, mvLeft, mvTop, mvWidth, mvHeight, mvPadding])

  // Seed the collapsed overlay geometry before first paint so it never flashes at 0,0 before the
  // tracking effect's first (post-paint) frame.
  useLayoutEffect(() => {
    if (fullscreen || !portaled || morphing) return
    const el = sentinelRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    mvLeft.set(r.left)
    mvTop.set(r.top)
    mvWidth.set(r.width)
    mvHeight.set(r.height)
    mvPadding.set(0)
  }, [fullscreen, portaled, morphing, mvLeft, mvTop, mvWidth, mvHeight, mvPadding])

  // Desktop, collapsed: render inline in the normal flow so the dialog's overflow clips it and the
  // footer stays above it. No fixed overlay, no portal.
  if (!portaled) {
    return (
      <div ref={inlineRef} className={cn('flex flex-col flex-1 min-h-0', className)}>
        <div className={shellInnerClassName} style={style}>
          {shellContent}
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Sentinel: invisible placeholder holding the editor's space in the document flow while its
          content lives in the portal. The portal positions itself on top of it while collapsed. */}
      <div ref={sentinelRef} aria-hidden className={cn('flex flex-col flex-1 min-h-0 invisible', className)} />

      {/* Portal: the single, never-remounted home of the editor content (touch keyboard-safe).
          Animates between the sentinel rect (collapsed) and the visual viewport (fullscreen).
          Padding/background apply only in fullscreen so the collapsed overlay matches inline. */}
      {createPortal(
        <motion.div
          // Geometry comes from motion values (left/top/width/height/padding), written either
          // imperatively each frame by the tracking effect (collapsed — zero lag) or sprung by the
          // morph effect (expand/collapse). No declarative `animate`, so React/Motion never re-applies
          // a frame-late rect over the live one. clipPath stays state-derived (a mask; its lag is
          // imperceptible). morphFromRect is seeded into the values in changeFullscreen (desktop).
          style={{ position: 'fixed', left: mvLeft, top: mvTop, width: mvWidth, height: mvHeight, padding: mvPadding, clipPath }}
          // The overlay is portaled to document.body, but its touch events still bubble through the
          // React tree to an enclosing sheet/drawer's swipe-to-dismiss handlers. This marker lets
          // that gesture handler ignore swipes that begin inside the editor, so dragging the
          // (maximized) editor never dismisses the surrounding sheet — the editor owns its own
          // expand/collapse gesture via the chrome header.
          data-editor-overlay=""
          className={cn('z-50 flex flex-col overflow-hidden', (fullscreen || morphing) && 'bg-background')}
        >
          <div className={shellInnerClassName} style={style}>
            {shellContent}
          </div>
        </motion.div>,
        document.body,
      )}
    </>
  )
}
