'use client'

import { useRef, useEffect, useState, useCallback } from 'react'

interface VirtualContainerResult {
  containerRef: React.RefObject<HTMLDivElement | null>
  scrollMargin: number
  cols: number
  containerWidth: number
  getScrollElement: () => HTMLElement | null
}

/**
 * Tracks scroll margin and optional column count for a virtualizer container.
 * `getColumns` MUST be a stable reference (module-level function or memoized) —
 * an inline arrow recreates it every render and causes an infinite measure loop.
 */
export function useVirtualContainer(getColumns?: (width: number) => number): VirtualContainerResult {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollMargin, setScrollMargin] = useState(0)
  // Infinity passes any `width <` breakpoint check, yielding the max column count before first measurement
  const [cols, setCols] = useState(() => getColumns?.(Infinity) ?? 1)
  const [containerWidth, setContainerWidth] = useState(0)

  const measure = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const scrollEl = el.closest('main')
    if (!scrollEl) return

    const elRect = el.getBoundingClientRect()
    const scrollRect = scrollEl.getBoundingClientRect()

    setScrollMargin(elRect.top - scrollRect.top + scrollEl.scrollTop)

    if (getColumns) {
      const width = elRect.width
      setCols(getColumns(width))
      setContainerWidth(width)
    }
  }, [getColumns])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    measure()

    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)

    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [measure])

  // containerRef is a stable ref so this callback never changes
  const getScrollElement = useCallback(
    () => containerRef.current?.closest('main') as HTMLElement | null,
    []
  )

  return { containerRef, scrollMargin, cols, containerWidth, getScrollElement }
}
