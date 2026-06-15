'use client'

import { type RefObject, useRef, useEffect, useState, useCallback } from 'react'
import { useIsTouch } from './use-is-touch'

interface VirtualContainerResult {
  containerRef: RefObject<HTMLDivElement | null>
  cols: number
  containerWidth: number
  // True when the `touch:` variant is active (coarse pointer OR viewport < lg), so
  // callers can feed the virtualizer a taller row height that matches the upsized cards.
  isTouch: boolean
  getScrollElement: () => HTMLElement | null
}

export function useVirtualContainer(getColumns?: (width: number) => number): VirtualContainerResult {
  const containerRef = useRef<HTMLDivElement>(null)
  const [cols, setCols] = useState(() => getColumns?.(Infinity) ?? 1)
  const [containerWidth, setContainerWidth] = useState(0)
  const isTouch = useIsTouch()

  const measure = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const scrollEl = el.closest('main')
    if (!scrollEl) return

    if (getColumns) {
      // Columns are driven by the *viewport* width (not the container width) so the
      // breakpoints match Tailwind's sm/lg semantics and the desktop layout stays
      // pixel-identical: the sidebar narrows the container below the lg threshold,
      // but the viewport is still >=1024px so the grid keeps its desktop column count.
      // documentElement.clientWidth mirrors how CSS media queries measure (excludes scrollbar).
      const viewportWidth = el.ownerDocument.documentElement.clientWidth
      setCols(getColumns(viewportWidth))
      setContainerWidth(el.getBoundingClientRect().width)
    }
  }, [getColumns])

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    measure()

    const debouncedMeasure = () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(measure, 100)
    }

    const ro = new ResizeObserver(debouncedMeasure)
    ro.observe(el)

    const scrollEl = el.closest('main')
    if (scrollEl) {
      ro.observe(scrollEl)
    }

    return () => {
      ro.disconnect()
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [measure])

  const getScrollElement = useCallback(
    () => containerRef.current?.closest('main') as HTMLElement | null,
    []
  )

  return { containerRef, cols, containerWidth, isTouch, getScrollElement }
}
