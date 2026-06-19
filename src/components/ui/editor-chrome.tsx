'use client'

import { useRef, useState, useEffect, useLayoutEffect, useCallback, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { Maximize2, Minimize2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useVisualViewport } from '@/hooks/use-visual-viewport'
import { useEditorHeaderDrag } from '@/hooks/use-editor-header-drag'
import { useIsTouch } from '@/hooks/use-is-touch'

// Past this downward drag (or a faster flick) the maximized editor collapses; below it the window
// snaps back to full screen.
const COLLAPSE_DRAG_PX = 90
const COLLAPSE_FLICK_VELOCITY = 0.5 // px per ms

// Spring used for both expand and collapse transitions.
const EXPAND_SPRING = { type: 'spring' as const, bounce: 0.08, duration: 0.5 }

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

  // The always-portal (never-remount) path exists to keep the on-screen keyboard up on touch.
  // Desktop has no on-screen keyboard, so there it only portals when fullscreen and otherwise
  // renders inline — where the dialog's overflow clips it and the footer sits below it, instead of
  // a fixed z-50 overlay painting over the footer.
  const portaled = fullscreen || isTouch

  // Spring the expand/collapse morph, but follow scroll/drag/keyboard instantly. `morphing` is on
  // only for the brief expand or collapse transition; every other geometry change (page scroll
  // tracking the sentinel, drag offset, keyboard resize) must apply with no spring or it visibly
  // lags behind the finger/scroll.
  const [morphing, setMorphing] = useState(false)
  const morphTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const changeFullscreen = useCallback((next: boolean) => {
    setMorphing(true)
    if (morphTimer.current) clearTimeout(morphTimer.current)
    morphTimer.current = setTimeout(() => setMorphing(false), 550)
    setFullscreen(next)
  }, [])

  useEffect(() => () => { if (morphTimer.current) clearTimeout(morphTimer.current) }, [])

  // Sentinel: an invisible placeholder that holds space in the normal document flow. The portal
  // reads its bounding rect to position/size itself on top of it while collapsed.
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [sentinelRect, setSentinelRect] = useState<DOMRect | null>(null)

  const updateSentinelRect = useCallback(() => {
    const el = sentinelRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    // Only re-render when the rect actually moved/resized, so the rAF loop below stays free.
    setSentinelRect((prev) =>
      prev && prev.left === rect.left && prev.top === rect.top && prev.width === rect.width && prev.height === rect.height
        ? prev
        : rect,
    )
  }, [])

  // Track the sentinel each animation frame while collapsed so the overlay follows every layout
  // change — including ancestor transform animations (drawer open) and drag, which emit no scroll
  // or resize events. getBoundingClientRect is cheap for one element and we setState only on real
  // movement, so this re-renders only when the geometry truly changes. Idle while fullscreen, where
  // the visual viewport drives the geometry instead.
  useEffect(() => {
    // Only the touch collapsed overlay reads the sentinel rect; desktop renders inline and
    // fullscreen uses the visual viewport — neither needs this loop.
    if (fullscreen || !isTouch) return
    let raf = 0
    const tick = () => {
      updateSentinelRect()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [fullscreen, isTouch, updateSentinelRect])

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

  // Desktop, collapsed: render inline in the normal flow so the dialog's overflow clips it and the
  // footer stays above it. No fixed overlay, no portal.
  if (!portaled) {
    return (
      <div className={cn('flex flex-col flex-1 min-h-0', className)}>
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
          animate={{ left: overlayLeft, top: overlayTop, width: overlayWidth, height: overlayHeight }}
          transition={morphing ? EXPAND_SPRING : { duration: 0 }}
          style={{ position: 'fixed' }}
          className={cn('z-50 flex flex-col overflow-hidden', fullscreen && 'p-3 bg-background')}
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
