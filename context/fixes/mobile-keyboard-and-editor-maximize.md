# Mobile Keyboard Insets + Editor Maximize/Collapse Gesture

_Status: implemented, **unverified on a real device** (the bugs are iOS-soft-keyboard / touch-gesture
behaviors that desktop Playwright cannot reproduce). Date: 2026-06-17._

This doc captures what was changed and why so the work can be continued or reverted cleanly if the
fixes don't hold up on a real phone.

---

## Problems reported (real iPhone, Brave/Safari)

1. **Maximized editor borders cut off when the keyboard opens.** With the code/markdown editor in
   full screen, focusing it opened the keyboard and the editor's left/right borders (and rounded
   corners) were sheared off the screen edges; the bottom went under the keyboard.
   (`context/mobile/IMG_5188 → IMG_5189`, `IMG_5192 → IMG_5191`.)
2. **Create-item bottom sheet: content editor hidden under the keyboard.** Tapping the Content
   editor in the Create New Item drawer opened the keyboard, and the editor block ended up at the
   bottom of the page *behind* the keyboard (also panned left — see the cut "Create New Item" /
   "Content" labels in `IMG_5190`). Desired: move the sheet up so the tapped editor is visible.
3. **Collapsing a maximized editor required hitting the small restore icon precisely.** Wanted:
   grab the header/top bar and swipe it down to collapse.

---

## Root cause (issues 1 & 2)

Both are the same iOS behavior. When the on-screen keyboard opens, the **visual viewport** shrinks
and can offset, but `position: fixed` layers stay sized/positioned against the **layout viewport**,
and iOS *pans the whole fixed layer* to keep the focused field visible. Result:

- The `fixed inset-0` fullscreen editor overlay gets panned → borders pushed off-screen, bottom under
  the keyboard (issue 1).
- The `fixed bottom-0` bottom sheet keeps its content editor at the bottom → behind the keyboard, and
  the pan shears its left edge (issue 2).

`100dvh` does **not** save us: on iOS `dvh` tracks the browser UI (URL bar), not the keyboard.

---

## Solution

### A. Shared hook — `src/hooks/use-visual-viewport.ts` (new)

Tracks `window.visualViewport` and exposes `{ width, height, offsetTop, offsetLeft, keyboardHeight }`
where `keyboardHeight = max(0, window.innerHeight - vv.height - vv.offsetTop)`.

- Implemented with **`useSyncExternalStore`** (React's official primitive for subscribing to a browser
  store), mirroring the existing `src/hooks/use-is-touch.ts`. Subscribes to `visualViewport`'s
  `resize` + `scroll` events.
- Uses a module-level cached snapshot so `getSnapshot` returns a referentially-stable object between
  changes (required by `useSyncExternalStore` or it loops).
- `getServerSnapshot` → `null`; callers fall back to a static layout until the first client read.
- **Verified against MDN/Context7**: this matches MDN's canonical "simulate `position: device-fixed`"
  pattern (offset from `visualViewport` + resize/scroll listeners). There is **no** React/Next or
  library wrapper for this — `window.visualViewport` is the only source of truth (the CSS
  `env(keyboard-inset-*)` / `navigator.virtualKeyboard` alternative is Chromium-only, useless on iOS).

### B. Issue 1 — pin the fullscreen overlay to the visual viewport — `src/components/ui/editor-chrome.tsx`

The fullscreen portal `<div>` is sized to the visible region instead of `inset-0`:

```
width = viewport.width
height = viewport.height
transform = translate(viewport.offsetLeft, viewport.offsetTop + dragY)
```

(`dragY` is the collapse-drag offset, see D.) Falls back to `inset-0` before the first measurement /
where the API is missing. This keeps borders intact and the editor above the keyboard.

### C. Issue 2 — lift the bottom sheet above the keyboard — `src/components/ui/bottom-sheet.tsx`

- When `keyboardHeight > 0`, the `SheetContent` gets inline `{ bottom: keyboardHeight, maxHeight:
  viewport.height }` (merged last so it overrides the base `bottom-0` / `max-h` and composes with the
  swipe-drag transform). The sheet now rests on top of the keyboard, footer + fields visible.
- A `focusin` listener + a `keyboardOpen` effect call `scrollIntoView({ block: 'center' })` on the
  focused field (the tapped input or Monaco's textarea), so the tapped content editor is centered in
  the visible area. base-ui locks body scroll, so this only scrolls the sheet body, not the page.

### D. Issue 3 — maximize/collapse via header drag + Motion FLIP animation — `editor-chrome.tsx`

> This part was extended (by the user) beyond the original "swipe down to collapse" ask. It now uses
> **Motion** (`motion/react`, `motion@^12.40.0`) for an animated expand/collapse and adds desktop
> mouse support and inline drag-up-to-expand.

- **Traffic-light dots are now buttons.** Red/yellow → collapse (`onCollapse`); green → expand
  (`onExpand`). Dimmed/inert (`disabled:opacity-30`) when their action is unavailable. `onCollapse`
  is only wired when `fullscreen === true`; `onExpand` only when `!fullscreen && fullscreenLabel`.
- **Header drag gestures** (armed whenever `fullscreenLabel` is set):
  - Fullscreen: drag the header **down** (touch or mouse) > `COLLAPSE_DRAG_PX` (90px) or a flick
    (velocity > `COLLAPSE_FLICK_VELOCITY` 0.5 px/ms) → collapse. The window follows the finger via
    `dragY` folded into the overlay transform. A plain click on the header also collapses.
  - Inline: drag the header **up** / click → expand. (Uses `dragYRef` only — no visual follow inline.)
    Same threshold constants as collapse.
  - `touchcancel` / `mousedown`-on-a-button are guarded; `toggleFullscreen` clears `dragY`.
- **Animation via `layoutId`**: the inline shell and the portal shell share `shellLayoutId`
  (`useId()`), both wrapped in `AnimatePresence`, so Motion does a FLIP between the two DOM positions
  with `EXPAND_TRANSITION` (`{ type: 'spring', bounce: 0.08, duration: 0.5 }`).
  `AnimatePresence` is required on both sides so Motion gets a proper exit lifecycle to snapshot the
  leaving element's rect before unmount — without it the collapse FLIP position is lost and the editor
  just appears instantly.
- **Overlay background fades** via the outer `motion.div` (`initial={{ opacity: 0 }}`,
  `animate={{ opacity: 1 }}`, `exit={{ opacity: 0 }}`, `transition: 0.2s easeInOut`) so the page is
  visible through the animation rather than a sudden grey flash.
- `touch-none cursor-grab select-none` on the header whenever `fullscreenLabel` is set (both states).

### E. Regression introduced by Motion — overlay borders cut on keyboard open (fix)

When the fullscreen overlay `<div>` was promoted to `<motion.div>` for the opacity fade, the
`style={{ transform: 'translate(offsetLeft, offsetTop)' }}` for viewport pinning broke:

**Root cause:** Motion decomposes a CSS `transform` string in the `style` prop into internal
MotionValues at mount time, then stops re-reading the prop. When `viewport.offsetLeft/Top` change
(keyboard opens), the internal MotionValues retain the old values → overlay stays at the wrong position
→ borders cut/shifted.

**Fix:** Use Motion's native `x`/`y` style props instead of a CSS `transform` string:

```tsx
// before (broken after motion.div promotion)
style={{ width: vp.width, height: vp.height, transform: `translate(${vp.offsetLeft}px, ${vp.offsetTop + dragY}px)` }}

// after (live MotionValues, update on every render)
style={{ x: vp.offsetLeft, y: vp.offsetTop + dragY, width: vp.width, height: vp.height }}
```

`x`/`y` are live MotionValues — they re-sync from the `style` prop on every render, so viewport
changes propagate instantly. `overlayStyle` type changed from `CSSProperties` to `MotionStyle`
(imported from `motion/react`).

### F. Bottom sheet scroll fix — center active field after keyboard opens

**Problem:** `centerFocusedField` called `active.scrollIntoView({ block: 'center' })` on the Monaco
textarea. Monaco positions its textarea at cursor coordinates (y ≈ 0 for line 1), so "centering" the
1×1 textarea put the top of Monaco in view but the editor block extended off-screen. Also, the
keyboard-open `useEffect` ran synchronously — before the sheet had resized — giving stale layout
measurements.

**Fix (both in `src/components/ui/bottom-sheet.tsx`):**

1. `centerFocusedField` now walks up from `activeElement` to find the first `overflow-y: auto/scroll`
   ancestor within `[data-slot=sheet-content]` (the mobileBody scroll container), then calls
   `scrollEl.scrollTo({ top: activeRect.top - bodyRect.top - 80 })` with 80px of padding above — enough
   to reveal the "Content" label and Monaco's chrome header bar. Falls back to `scrollIntoView` if no
   scrollable ancestor is found.
2. The `keyboardOpen` `useEffect` wraps the call in `requestAnimationFrame` so it runs after the sheet
   height/position has settled (same pattern already used by the `focusin` handler).

---

## Files touched

- `src/hooks/use-visual-viewport.ts` — new hook (shared)
- `src/components/ui/editor-chrome.tsx` — overlay viewport-pinning (x/y MotionStyle fix) + traffic-light
  dot buttons + header drag gestures (collapse & expand) + inline drag-up + Motion FLIP/AnimatePresence.
  (`EditorChromeHeader` gained `onCollapse`/`onExpand` props + touch/mouse handler props.)
- `src/components/ui/bottom-sheet.tsx` — keyboard lift + explicit scroll-body centering + rAF timing.
- `package.json` — `motion` dependency added (`^12.40.0`).

Consumers of `EditorChromeShell` (`src/components/ui/code-editor.tsx`,
`src/components/ui/markdown-editor.tsx` via `src/components/shared/item-content-input.tsx`) were not
changed — the public props (`fullscreenLabel`, etc.) are unchanged.

---

## Verification done

- `npm run lint` — clean on all sessions.
- **Not** verified on a real device or in a browser with a soft keyboard. Production build not run.

---

## If it's still broken — where to continue

**Re-test on a real iPhone** (the only way to see the keyboard inset): both flows in the screenshots
— maximize the editor + focus it; open Create New Item + tap the Content editor.

Likely suspects / things to check, in order:

1. **`keyboardHeight` formula on the actual device.** Log `window.innerHeight`, `vv.height`,
   `vv.offsetTop`. On some iOS versions `innerHeight` already reflects the keyboard, which would make
   `keyboardHeight` read 0 (no lift) or double-count. If so, derive the inset differently (e.g. from a
   measured layout-viewport element height as in MDN's example) rather than `window.innerHeight`.
2. **Bottom sheet still behind keyboard.** Confirm the inline `{ bottom, maxHeight }` actually wins
   over the base classes (inline style should). Check base-ui isn't re-applying a transform that fights
   it. The `scrollTo` in `centerFocusedField` targets the first `overflow-y:auto` ancestor of
   `activeElement`. If Monaco's DOM changes add an intermediate scrollable wrapper, the found
   `scrollEl` would be wrong — log it to verify.
3. **Fullscreen overlay still sheared.** Verify the `motion.div` overlay is getting `x`/`y` from
   `viewport` (not the `{}` fallback) — the hook must have measured before fullscreen opens. If iOS
   still pans the overlay, check no ancestor transform is creating a new containing block (the portal to
   `document.body` should prevent that).
4. **Motion FLIP jank / layout flash.** If the expand/collapse flickers, the simplest robust fallback
   is to drop Motion and go back to the plain conditional portal (the viewport-pinning + gesture logic
   does **not** depend on Motion — only the animation does). The pre-Motion version was a single
   `createPortal` with `dragY` translate and no `AnimatePresence`.

**Cheapest safe fallback** if the whole thing regresses: keep `use-visual-viewport.ts` + the
bottom-sheet lift (issue 2 is the highest-value fix), and revert the editor-chrome Motion/gesture
additions to the icon-only collapse. The hook is self-contained and low-risk.
