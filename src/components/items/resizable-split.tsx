'use client'

import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface ResizableSplitProps {
  left: ReactNode
  right: ReactNode
  defaultLeftPct?: number
  minLeftPct?: number
  maxLeftPct?: number
  className?: string
  ariaLabel?: string
}

const KEYBOARD_STEP_PCT = 3

export function ResizableSplit({
  left,
  right,
  defaultLeftPct = 45,
  minLeftPct = 30,
  maxLeftPct = 70,
  className,
  ariaLabel = 'Resize columns',
}: ResizableSplitProps) {
  const [leftPct, setLeftPct] = useState(defaultLeftPct)
  const containerRef = useRef<HTMLDivElement>(null)
  const leftRef = useRef<HTMLDivElement>(null)
  const separatorRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  // Constant offset from the left column's right edge to the divider's visual center
  // (its left margin + half its width). Measured once per drag so the divider line tracks
  // the cursor exactly instead of sitting ~9px to its right.
  const gutterRef = useRef(0)

  const clamp = useCallback(
    (pct: number) => Math.min(maxLeftPct, Math.max(minLeftPct, pct)),
    [minLeftPct, maxLeftPct],
  )

  const updateFromClientX = useCallback(
    (clientX: number) => {
      const container = containerRef.current
      if (!container) return
      const containerRect = container.getBoundingClientRect()
      if (containerRect.width === 0) return
      // Absolute + stateless: place the divider center at the cursor. Independent of the
      // previous render, so rapid moves can't under/overshoot from stale geometry.
      const leftWidth = clientX - containerRect.left - gutterRef.current
      setLeftPct(clamp((leftWidth / containerRect.width) * 100))
    },
    [clamp],
  )

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const leftEl = leftRef.current
    const separator = separatorRef.current
    if (leftEl && separator) {
      const separatorRect = separator.getBoundingClientRect()
      gutterRef.current = separatorRect.left + separatorRect.width / 2 - leftEl.getBoundingClientRect().right
    }
    draggingRef.current = true
    // Guard: pointer capture can throw if the pointer is no longer active (rare). The drag still
    // works without it since draggingRef is already set.
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // ignore — capture is a nicety, not required for the drag to function
    }
  }

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return
    updateFromClientX(e.clientX)
  }

  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      setLeftPct((pct) => clamp(pct - KEYBOARD_STEP_PCT))
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      setLeftPct((pct) => clamp(pct + KEYBOARD_STEP_PCT))
    } else if (e.key === 'Home') {
      e.preventDefault()
      setLeftPct(minLeftPct)
    } else if (e.key === 'End') {
      e.preventDefault()
      setLeftPct(maxLeftPct)
    }
  }

  return (
    <div ref={containerRef} className={cn('flex min-h-0 w-full', className)}>
      <div ref={leftRef} className="flex min-w-0 flex-col overflow-hidden" style={{ width: `${leftPct}%` }}>
        {left}
      </div>
      <div
        ref={separatorRef}
        role="separator"
        aria-orientation="vertical"
        aria-label={ariaLabel}
        aria-valuenow={Math.round(leftPct)}
        aria-valuemin={minLeftPct}
        aria-valuemax={maxLeftPct}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onKeyDown={handleKeyDown}
        className="group relative mx-1.5 flex w-1.5 shrink-0 cursor-col-resize touch-none items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="h-full w-px rounded-full bg-border transition-colors group-hover:bg-foreground/30 group-focus-visible:bg-ring" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">{right}</div>
    </div>
  )
}
