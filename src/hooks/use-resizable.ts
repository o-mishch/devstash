'use client'

import { useState, useEffect, useCallback, useEffectEvent } from 'react'

interface UseResizableOptions {
  defaultWidth: number
  /** Minimum width in px — floor for the vw-based calculation */
  minPx?: number
  /** Fraction of viewport width for the minimum, e.g. 0.25 = 25vw */
  minVw?: number
  /** CSS selector for the element whose left edge is the max boundary */
  maxBoundarySelector?: string
  /** Gap as a fraction of viewport width between drawer and the boundary, e.g. 0.05 = 5vw */
  maxBoundaryGapVw?: number
}

interface UseResizableReturn {
  width: number
  dragging: boolean
  startResize: () => void
}

export function useResizable({
  defaultWidth,
  minPx = 380,
  minVw = 0.25,
  maxBoundarySelector = 'main',
  maxBoundaryGapVw = 0.05,
}: UseResizableOptions): UseResizableReturn {
  const [rawWidth, setRawWidth] = useState(defaultWidth)
  const [dragging, setDragging] = useState(false)
  const [boundaryLeft, setBoundaryLeft] = useState(
    () => typeof document !== 'undefined'
      ? (document.querySelector(maxBoundarySelector)?.getBoundingClientRect().left ?? 0)
      : 0
  )

  // Keep boundaryLeft in sync — ResizeObserver fires on sidebar expand/collapse and window resize
  useEffect(() => {
    const el = document.querySelector(maxBoundarySelector)
    if (!el) return
    const ro = new ResizeObserver(() => setBoundaryLeft(el.getBoundingClientRect().left))
    ro.observe(el)
    return () => ro.disconnect()
  }, [maxBoundarySelector])

  // Derive clamped width during render — no DOM reads needed in any effect
  const vw = typeof window !== 'undefined' ? window.innerWidth : defaultWidth
  const min = Math.max(minPx, Math.round(vw * minVw))
  const max = vw - boundaryLeft - Math.round(vw * maxBoundaryGapVw)
  const width = Math.min(Math.max(rawWidth, min), max)

  const onMouseMove = useEffectEvent((e: MouseEvent) => {
    const currentVw = window.innerWidth
    const currentMin = Math.max(minPx, Math.round(currentVw * minVw))
    const currentMax = currentVw - boundaryLeft - Math.round(currentVw * maxBoundaryGapVw)
    setRawWidth(Math.min(Math.max(currentVw - e.clientX, currentMin), currentMax))
  })

  useEffect(() => {
    if (!dragging) return

    function onMouseUp() {
      setDragging(false)
    }

    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)

    return () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [dragging])

  const startResize = useCallback(() => setDragging(true), [])

  return { width, dragging, startResize }
}
