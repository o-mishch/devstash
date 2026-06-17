'use client'

import { useRef, useState, useEffect, useId, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence, type MotionStyle } from 'motion/react'
import { Maximize2, Minimize2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useVisualViewport } from '@/hooks/use-visual-viewport'
import { useEditorHeaderDrag } from '@/hooks/use-editor-header-drag'

// Past this downward drag (or a faster flick) the maximized editor collapses; below it the window
// snaps back to full screen.
const COLLAPSE_DRAG_PX = 90
const COLLAPSE_FLICK_VELOCITY = 0.5 // px per ms

// Spring used for both expand and collapse transitions via layoutId.
const EXPAND_TRANSITION = { type: 'spring' as const, bounce: 0.08, duration: 0.5 }

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
}

// The full editor/viewer surface: the rounded dark bordered shell + the traffic-light header bar
// + caller content. Callers supply the background (a `bg-*` class or a dynamic `style` for the
// markdown theme) and any sizing overrides via `className`.
//
// The optional fullscreen toggle lives here (not in an outer wrapper) so it sits inside the chrome
// header next to the copy button — the established editor pattern (VS Code / CodeSandbox) — instead
// of floating over the editor surface. When active the whole shell is portalled to document.body:
// the surrounding Dialog centers itself with a CSS transform, which would otherwise become the
// containing block for the shell's `position: fixed` and size it against the dialog, not the
// viewport. Portalling to body escapes that transform.
//
// Expand/collapse is animated via Motion's layoutId: the inline shell and the portal shell share
// the same ID so Motion tracks the bounding rect across the DOM transition and smoothly morphs
// between the two positions with a spring.
export function EditorChromeShell({ header, children, className, style, fullscreenLabel }: EditorChromeShellProps) {
  // Unique per-instance so multiple shells on the same page don't share a layoutId.
  const shellLayoutId = useId()
  const [fullscreen, setFullscreen] = useState(false)
  const viewport = useVisualViewport()

  // Drag-down-to-collapse: grabbing the chrome header and pulling down slides the maximized window
  // with the finger and collapses it on release (past a threshold or a flick) — so users don't have
  // to hit the small restore icon. Touch-only by construction; the mirror ref keeps onTouchEnd
  // reading the latest offset regardless of React's render timing.
  const [dragY, setDragY] = useState(0)
  const dragYRef = useRef(0)

  const setDrag = (value: number) => {
    dragYRef.current = value
    setDragY(value)
  }

  const collapseDrag = useEditorHeaderDrag({
    active: fullscreen,
    direction: 'down',
    thresholdPx: COLLAPSE_DRAG_PX,
    flickVelocity: COLLAPSE_FLICK_VELOCITY,
    onTrigger: () => setFullscreen(false),
    onClickWithoutDrag: () => setFullscreen(false),
    onDragOffset: setDrag,
  })

  const expandDrag = useEditorHeaderDrag({
    active: !fullscreen && Boolean(fullscreenLabel),
    direction: 'up',
    thresholdPx: COLLAPSE_DRAG_PX,
    flickVelocity: COLLAPSE_FLICK_VELOCITY,
    onTrigger: () => setFullscreen(true),
    onClickWithoutDrag: () => setFullscreen(true),
  })

  // Toggle full screen, clearing any drag offset so the overlay always opens flush.
  const toggleFullscreen = () => {
    setDrag(0)
    setFullscreen((open) => !open)
  }

  useEffect(() => {
    if (!fullscreen) return
    // Capture-phase listener so Esc collapses the editor before a surrounding Dialog/Sheet can
    // treat it as a request to close the whole form; stopPropagation keeps it from bubbling there.
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setFullscreen(false)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [fullscreen])

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

  // Collapse drag is armed in fullscreen; expand drag is armed inline when a fullscreen label exists.
  let headerDragHandlers: ReturnType<typeof useEditorHeaderDrag> | undefined
  if (fullscreen) headerDragHandlers = collapseDrag
  else if (fullscreenLabel) headerDragHandlers = expandDrag

  // Shared inner content for both shells — handlers are armed in whichever mode is active.
  const shellContent = (
    <>
      <EditorChromeHeader
        className={fullscreenLabel ? 'touch-none cursor-grab active:cursor-grabbing select-none' : undefined}
        onCollapse={fullscreen ? () => setFullscreen(false) : undefined}
        onExpand={!fullscreen && fullscreenLabel ? toggleFullscreen : undefined}
        dragHandlers={headerDragHandlers}
      >
        {header}
        {fullscreenToggle}
      </EditorChromeHeader>
      {children}
    </>
  )

  const shellClassName = cn(
    'flex flex-col flex-1 min-h-0 rounded-lg border text-card-foreground shadow-sm overflow-hidden ring-1 ring-white/10 ring-inset',
    className,
  )

  // Pin the overlay to the visual viewport so the on-screen keyboard can't pan the editor's
  // borders off-screen (iOS scrolls position:fixed layers out from under the keyboard). Size to
  // the visible region and translate by its offset; before the first measurement (and where the
  // API is unavailable) fall back to filling the layout viewport via inset-0.
  // dragY (header drag-to-collapse) is folded into the vertical translate so it composes with the
  // viewport offset instead of clobbering it. transition is left off so the window tracks the
  // finger live and the viewport pin stays instant.
  // Use Motion's native x/y props instead of a CSS transform string so these update correctly
  // when the viewport changes (e.g. keyboard opens). A CSS transform string in a motion.div's
  // style prop is decomposed into internal MotionValues at mount time and stops tracking prop
  // changes; x/y are live MotionValues that re-sync on every render.
  let overlayStyle: MotionStyle
  if (viewport) {
    overlayStyle = {
      x: viewport.offsetLeft,
      y: viewport.offsetTop + dragY,
      width: viewport.width,
      height: viewport.height,
    }
  } else if (dragY) {
    overlayStyle = { y: dragY }
  } else {
    overlayStyle = {}
  }

  return (
    <>
      {/* Inline shell — present when not fullscreen; AnimatePresence gives Motion time to snapshot
          the fullscreen element's rect before it unmounts, so the FLIP plays correctly in both
          directions. */}
      <AnimatePresence>
        {!fullscreen && (
          <motion.div
            layoutId={shellLayoutId}
            transition={EXPAND_TRANSITION}
            className={shellClassName}
            style={style}
          >
            {shellContent}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Fullscreen portal — AnimatePresence keeps the portal element alive long enough for Motion
          to record its rect before unmounting, enabling the collapse FLIP back to the inline shell. */}
      {createPortal(
        <AnimatePresence>
          {fullscreen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className={cn(
                'fixed z-50 flex flex-col bg-background p-3',
                viewport ? 'left-0 top-0' : 'inset-0',
              )}
              style={overlayStyle}
            >
              <motion.div
                layoutId={shellLayoutId}
                transition={EXPAND_TRANSITION}
                className={cn(shellClassName, 'h-full')}
                style={style}
              >
                {shellContent}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  )
}
