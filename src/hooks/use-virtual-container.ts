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
  // Offset (px) of the list wrapper from the top of the `<main>` scroll content. Fed to
  // the virtualizer's `scrollMargin` so multiple lists can share the single `<main>` scroller
  // (the dashboard stacks several cards in one scroll). Scroll-invariant by construction.
  scrollMargin: number
  getScrollElement: () => HTMLElement | null
}

export function useVirtualContainer(getColumns?: (width: number) => number): VirtualContainerResult {
  const containerRef = useRef<HTMLDivElement>(null)
  const [cols, setCols] = useState(() => getColumns?.(Infinity) ?? 1)
  const [containerWidth, setContainerWidth] = useState(0)
  const [scrollMargin, setScrollMargin] = useState(0)
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

    // Distance from the start of <main>'s scrollable content to the top of this list.
    // rect.top - mainTop cancels the current scroll; adding scrollTop yields the absolute
    // content offset, so the value is stable regardless of how far the page is scrolled.
    const margin = el.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop
    setScrollMargin(Math.max(0, Math.round(margin)))
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

  const getScrollElement = useCallback(
    () => containerRef.current?.closest('main') as HTMLElement | null,
    []
  )

  return { containerRef, cols, containerWidth, isTouch, scrollMargin, getScrollElement }
}
