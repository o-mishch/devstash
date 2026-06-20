// Pure scroll-margin geometry for the virtual grid, extracted from `useVirtualContainer` so the
// coordinate-frame math (the off-by-one-prone part) is unit-testable. Both results are clamped to a
// non-negative whole pixel — TanStack's `scrollMargin` is a pixel offset and must never go negative.

// Absolute document offset of a list's top, used as the window-virtualizer `scrollMargin` (mobile
// document-scroll shell). `listTop` is viewport-relative (rect.top); adding the document scroll
// position cancels the current scroll, so the result is invariant to how far the page is scrolled.
export function computeWindowScrollMargin(listTop: number, scrollY: number): number {
  return Math.max(0, Math.round(listTop + scrollY))
}

// Offset of a list's top within a <main> scroll container, used as the element-virtualizer
// `scrollMargin` (desktop). `(listTop - mainTop)` cancels the current scroll; adding `mainScrollTop`
// yields the absolute content offset, stable regardless of how far <main> is scrolled.
export function computeMainScrollMargin(listTop: number, mainTop: number, mainScrollTop: number): number {
  return Math.max(0, Math.round(listTop - mainTop + mainScrollTop))
}
