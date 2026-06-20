'use client'

import { type RefObject, useRef, useEffect, useState, useCallback } from 'react'
import { computeMainScrollMargin, computeWindowScrollMargin } from '@/lib/utils/scroll-margin'

interface VirtualContainerOptions {
  getColumns?: (width: number) => number
  // When true the real scroller is the browser window (mobile document-scroll shell), not <main>.
  // Changes how scrollMargin is measured (absolute document offset vs. offset within <main>) so the
  // window- or element-virtualizer's coordinates line up either way.
  windowMode: boolean
}

interface VirtualContainerResult {
  containerRef: RefObject<HTMLDivElement | null>
  cols: number
  containerWidth: number
  // Offset (px) from the start of the scroller to the top of this list, fed to the virtualizer's
  // `scrollMargin`. Element mode: offset within the <main> scroll content. Window mode: absolute
  // offset from the top of the document. Scroll-invariant by construction either way.
  scrollMargin: number
}

export function useVirtualContainer({ getColumns, windowMode }: VirtualContainerOptions): VirtualContainerResult {
  const containerRef = useRef<HTMLDivElement>(null)
  const [cols, setCols] = useState(() => getColumns?.(Infinity) ?? 1)
  const [containerWidth, setContainerWidth] = useState(0)
  const [scrollMargin, setScrollMargin] = useState(0)

  const measure = useCallback(() => {
    const el = containerRef.current
    if (!el) return

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

    if (windowMode) {
      // Window scroller: absolute offset from the top of the document. window.scrollY is the only
      // source of the document scroll position — there is no React/Next equivalent for a layout read.
      setScrollMargin(computeWindowScrollMargin(el.getBoundingClientRect().top, window.scrollY))
      return
    }

    const scrollEl = el.closest('main')
    if (!scrollEl) return
    // Distance from the start of <main>'s scrollable content to the top of this list.
    setScrollMargin(
      computeMainScrollMargin(el.getBoundingClientRect().top, scrollEl.getBoundingClientRect().top, scrollEl.scrollTop),
    )
  }, [getColumns, windowMode])

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

    // Observe the page content wrapper too: cards above the list (e.g. dashboard sections
    // resolving from their own Suspense boundaries) grow it and shift our offset down, which
    // a resize of `el`/`main` alone wouldn't catch. Re-measuring keeps scrollMargin correct.
    const contentEl = el.closest('.app-page')
    if (contentEl && contentEl !== scrollEl) {
      ro.observe(contentEl)
    }

    return () => {
      ro.disconnect()
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [measure])

  return { containerRef, cols, containerWidth, scrollMargin }
}
