import { describe, it, expect } from 'vitest'
import { computeWindowScrollMargin, computeMainScrollMargin } from '@/lib/utils/scroll-margin'

describe('computeWindowScrollMargin', () => {
  it('adds the document scroll position to the viewport-relative top', () => {
    // The list sits 80px below the viewport top while the page is scrolled 200px down → 280px from
    // the document top, which stays constant as the user scrolls.
    expect(computeWindowScrollMargin(80, 200)).toBe(280)
  })

  it('is scroll-invariant: same document offset at any scroll position', () => {
    expect(computeWindowScrollMargin(280, 0)).toBe(computeWindowScrollMargin(80, 200))
  })

  it('rounds subpixel rects to a whole pixel', () => {
    expect(computeWindowScrollMargin(80.4, 200.1)).toBe(281)
  })

  it('clamps a negative offset (list scrolled above the document top) to 0', () => {
    expect(computeWindowScrollMargin(-300, 100)).toBe(0)
  })
})

describe('computeMainScrollMargin', () => {
  it('measures the list offset within the <main> scroll content', () => {
    // List top 120px below viewport, <main> top at 64px, <main> scrolled 150px → 206px into content.
    expect(computeMainScrollMargin(120, 64, 150)).toBe(206)
  })

  it('is scroll-invariant: unchanged as <main> scrolls', () => {
    // Scrolling <main> by 150px moves the list rect up by 150px, which scrollTop cancels.
    expect(computeMainScrollMargin(120, 64, 150)).toBe(computeMainScrollMargin(-30, 64, 300))
  })

  it('rounds subpixel rects to a whole pixel', () => {
    expect(computeMainScrollMargin(120.6, 64.1, 150)).toBe(207)
  })

  it('clamps a negative offset to 0', () => {
    expect(computeMainScrollMargin(0, 200, 0)).toBe(0)
  })
})
