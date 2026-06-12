'use client'

import { type RefObject, useRef, useEffect, useState, useCallback } from 'react'

interface VirtualContainerResult {
  containerRef: RefObject<HTMLDivElement | null>
  cols: number
  containerWidth: number
  getScrollElement: () => HTMLElement | null
}

export function useVirtualContainer(getColumns?: (width: number) => number): VirtualContainerResult {
  const containerRef = useRef<HTMLDivElement>(null)
  const [cols, setCols] = useState(() => getColumns?.(Infinity) ?? 1)
  const [containerWidth, setContainerWidth] = useState(0)

  const measure = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const scrollEl = el.closest('main')
    if (!scrollEl) return

    if (getColumns) {
      const width = el.getBoundingClientRect().width
      setCols(getColumns(width))
      setContainerWidth(width)
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

  return { containerRef, cols, containerWidth, getScrollElement }
}
