# Mobile Document Scroll + Window-Virtualized Grid

_Status: implemented, **unverified on a real device** (the payoff — the iOS/Android URL bar collapsing
on scroll — only manifests on a real mobile browser, not desktop Playwright). Date: 2026-06-20._

This doc captures what changed and why so the work can be continued or reverted cleanly if it doesn't
hold up on a real phone.

---

## Problem

On mobile the app shell was a fixed-height `h-screen overflow-hidden` frame with an inner `<main>`
scroll container. Because the document itself never scrolled, the browser URL bar never collapsed,
permanently eating vertical space. The virtualized item grid (`TanStackVirtualGrid`) was bound to the
`<main>` element scroller, so it could not be moved onto the window scroller without breaking its
`scrollMargin` math.

## Change

1. **App shell lets the document scroll on mobile, keeps `<main>` as the scroller on desktop**
   (`src/app/(app)/layout.tsx`): shell is `min-h-dvh` with `lg:h-screen lg:overflow-hidden`; the
   header is `sticky top-0 lg:static`; `<main>` is `overflow-x-hidden lg:overflow-y-auto`. So on
   mobile the window scrolls (URL bar collapses); on desktop nothing changes.

2. **Grid picks its virtualizer by scroller** (`src/components/items/tanstack-virtual-grid.tsx`):
   `TanStackVirtualGrid` branches on `useIsTouch()` up front — `WindowVirtualGrid`
   (`useWindowVirtualizer`, mobile) vs `MainVirtualGrid` (`useVirtualizer` bound to `<main>`,
   desktop). `isTouch` is stable per device (only flips across the `lg` breakpoint), so the variant
   never remounts in normal use. A shared `useGridRows` builds the row matrix + per-row height, and a
   presentational `VirtualGridBody` renders the windowed rows for both variants.

3. **`useVirtualContainer` learns a `windowMode` flag** (`src/hooks/use-virtual-container.ts`): it
   measures `scrollMargin` as the absolute document offset in window mode, or the offset within
   `<main>` otherwise. The coordinate-frame formulas are extracted to
   `src/lib/utils/scroll-margin.ts` (`computeWindowScrollMargin` / `computeMainScrollMargin`) and
   unit-tested (`scroll-margin.test.ts`).

4. **Editor overlay clips to its scroll container while collapsed** (`src/components/ui/editor-chrome.tsx`):
   the `position: fixed` portal now applies a `clip-path` of its overflow-clipping ancestors' combined
   bounds so it stops painting over the form header/footer once the document scrolls. The clip is
   recomputed only when the sentinel rect actually moves (gated inside the rAF loop) to keep the
   per-ancestor `getBoundingClientRect` reads off the idle path.

5. **Swipe-to-dismiss ignores gestures starting in the editor overlay**
   (`src/hooks/use-swipe-to-dismiss.ts`): the portal carries a `data-editor-overlay` marker; the
   dismiss guard walks the touch target's DOM ancestors and keeps (does not dismiss) any gesture that
   began inside it, so dragging a maximized editor never closes the surrounding sheet.

---

## Follow-up fixes (2026-06-20)

Two real-device regressions surfaced after the initial change; both trace back to it.

6. **`<main>` was still a scroll container on mobile** (`src/app/(app)/layout.tsx`): it used
   `overflow-x-hidden`. With the vertical axis left `visible`, CSS coerces `overflow-y` → `auto`
   (the spec rule: a `hidden`/`scroll`/`auto` axis paired with a `visible` axis promotes `visible`
   to `auto`), so `<main>` silently became a vertical scroller. The document never scrolled until
   `<main>` bottomed out — so the URL bar only collapsed after scrolling to the last dashboard
   section, and the window virtualizer (which assumes the window scrolls) was undermined. Switched
   to `overflow-x-clip`, which clips horizontal overflow **without** establishing a scroll
   container (`clip` is exempt from the coercion rule), so on mobile the document is the sole
   scroller and the URL bar collapses on the first scroll. Desktop still scrolls `<main>` via
   `lg:overflow-y-auto`.

7. **Collapsed editor overlay hidden until a scroll, in the mobile create sheet**
   (`src/components/ui/editor-chrome.tsx`): the clip-path recompute (added in change 4) was gated
   behind the sentinel *moving*. During the bottom sheet's slide-up open animation the clip was
   computed against mid-animation ancestor rects; once the sheet settled the sentinel stopped
   moving, so the clip was never recomputed and a stale `insetTop` clipped the editor body away
   (a dark sliver near the footer) until a stray scroll nudged the sentinel. The rAF tick now
   recomputes the sentinel and the clip together every frame so the clip converges to the settled
   geometry; the per-frame loop already measured the sentinel, so the cost is only 1–3 extra
   ancestor `getBoundingClientRect` reads and the setState guards suppress redundant re-renders.

## Verify on a real device

- Scroll the item grid on a phone → URL bar collapses; grid stays correctly positioned (no jump,
  infinite-scroll still fires).
- Desktop `<main>` scrolling and grid layout unchanged.
- Collapse a touch editor inside a scrolling form → overlay clips to the form, never paints over
  header/footer; swiping the editor doesn't dismiss the sheet.
