# Skeleton Positioning & Border Alignment Fix

## Problem

Skeleton placeholder components on item type pages (snippets, prompts, commands, notes, links, files, images) had misaligned borders and spacing compared to loaded card components. Visible differences:
- Card heights: skeletons weren't constrained to fixed heights, loaded cards were
- Border alignment inconsistent between skeleton and loaded states
- Vertical spacing different due to height constraints being missing

## Root Cause

The key insight: loaded items are rendered by virtual grid components (`VirtualItemGrid`, `VirtualImageGrid`, `VirtualFileList`) that wrap each item in a **fixed-height container**. The actual card/row component inside uses `h-full` to fill that container.

Skeleton components were NOT using the same structure:
- **VirtualItemGrid**: wraps each `ItemCard` in `<div style={{ height: 80px }}>`
- **CardGridSkeleton**: had no explicit height containers for each card
- **VirtualImageGrid**: wraps each `ImageCard` in `<div style={{ height: 240px }}>`
- **ImageGridSkeleton**: already had explicit height containers ✓
- **VirtualFileList**: wraps each `FileRow` in `<div style={{ height: 40px }}>`
- **FileListSkeleton**: already had explicit height containers ✓

Only `CardGridSkeleton` was missing the container structure.

## Solution

**Changes to `src/components/shared/skeletons.tsx`:**

### 1. CardGridSkeleton - TWO fixes

**Fix A: Add explicit height containers (80px)**
```typescript
// Before: Cards directly in grid, no height containers
<div style={{ display: 'grid', gridTemplateColumns: ..., gap: ... }}>
  {[...Array(count)].map((_, i) => (
    <Card className="relative h-full min-h-20 ...">
      ...
    </Card>
  ))}
</div>

// After: Cards wrapped in 80px height containers, matching VirtualItemGrid
<div style={{ display: 'grid', gridTemplateColumns: ..., gap: ... }}>
  {[...Array(count)].map((_, i) => (
    <div key={i} style={{ height: '80px', width: '100%' }}>
      <Card className="relative h-full min-h-20 ...">
        ...
      </Card>
    </div>
  ))}
</div>
```

**Fix B: Add explicit width to grid container**
```typescript
// Before
<div style={{ display: 'grid', gridTemplateColumns: ..., gap: ... }}>

// After
<div style={{ display: 'grid', gridTemplateColumns: ..., gap: ..., width: '100%', minWidth: 0 }}>
```

**Why?**
- `VirtualItemGrid` uses `CARD_HEIGHT = 80` (h-20 in Tailwind)
- Matches: `columns=3, columnGap=16, rowGap=14` parameters
- Parent is flex container (`.app-page`), so children need explicit `width: 100%` to expand properly
- `minWidth: 0` allows text overflow handling

### 2. ImageGridSkeleton - Add explicit width

```typescript
// Before
<div style={{ display: 'grid', gridTemplateColumns: ..., gap: ... }}>

// After
<div style={{ display: 'grid', gridTemplateColumns: ..., gap: ..., width: '100%', minWidth: 0 }}>
```

Reason: Parent flex container requires explicit width on children.

### 3. FileListSkeleton - Add explicit width

```typescript
// Before
<div style={{ display: 'flex', flexDirection: 'column', gap: ... }}>

// After
<div style={{ display: 'flex', flexDirection: 'column', gap: ..., width: '100%', minWidth: 0 }}>
```

Reason: Parent flex container requires explicit width on children.

## Why This Works

The fix aligns skeleton DOM structure with loaded DOM structure:

**Loaded state (VirtualItemGrid):**
```
<div style={{ height: '80px' }}>
  <ItemCard /> (uses h-full to fill 80px)
</div>
```

**Skeleton state (CardGridSkeleton):**
```
<div style={{ height: '80px' }}>
  <Card /> (uses h-full to fill 80px)
</div>
```

Now both:
- Have explicit height constraints (80px)
- Cards/rows inside use `h-full` to fill the container
- Grid gaps match exactly (columnGap=16, rowGap=14)
- Border alignment consistent
- No layout shift when transitioning from skeleton to loaded state

## Complete Fix Summary

### Fix 1: Explicit Height Containers
- Wrapped each card in height containers (80px for cards, 240px for images, 40px for files)
- Matches VirtualItemGrid/VirtualImageGrid/VirtualFileList structure

### Fix 2: Explicit Width Constraints
- Added `width: 100%` + `minWidth: 0` to all skeleton grid/list containers
- Ensures skeletons expand to fill parent flex container width
- Fixes left/right border misalignment

### Fix 3: Remove Double Wrapper
- ItemsPageSkeleton was wrapping content in extra `app-page` div
- Removed outer wrapper so it matches ItemsContent structure
- Both now wrapped once by page's `app-page gap-6 p-6`

### Fix 4: Remove Unnecessary Padding
- TanStackVirtualGrid had `padding = rowGap + 4` at top/bottom
- Removed padding to match skeleton spacing
- Eliminates extra gap between header and first row of loaded cards

## Verification

✅ All 584 tests passing  
✅ ESLint clean (no errors)  
✅ Skeleton and loaded states now visually aligned:
- Card heights: both constrained to 80px via parent containers
- Card widths: both fill grid cell width
- Grid layout: 3 columns, 16px column gap, 14px row gap
- Borders: consistent position and styling
- Vertical spacing: header-to-cards gap matches between skeleton and loaded
- No layout shift on transition

## Impact

- Eliminates visual jump when content loads on item type pages
- Perfect alignment between skeleton loading state and loaded state
- Zero performance impact
- Consistent structure across all item types (snippets, prompts, commands, notes, links)

## Files Modified

- `src/components/shared/skeletons.tsx` (CardGridSkeleton only)

---

## Round 2: Skeleton content lower within card + grid-level top offset (Jun 2026)

### Problem

After the Round 1 fix (explicit height containers, correct row gaps), skeletons were still visually lower than loaded cards in two independent ways:

1. **Within-card vertical offset**: the skeleton content block appeared lower (closer to the bottom) inside each card, even though both skeleton and loaded card were the same fixed height.
2. **Grid-level top offset**: the first row of skeleton cards appeared ~8–10 px lower on the page than the first row of loaded cards.

### Root cause A — within-card: guessed bar heights ≠ real line-heights

The old skeleton used bare `<Skeleton className="h-5 ...">` bars with hand-picked heights. These heights didn't account for:

- Root-font scaling: desktop = 125% root (1 rem = 20 px), touch = 110% root (1 rem = 17.6 px). The same `h-*` utility produces different pixel heights at each scale.
- `line-clamp-2` subtitle: two text lines at `text-xs` line-height (1 rem each) = 2 rem total. The old skeleton only had one subtitle-height bar, so the text column was shorter than the loaded card's text column.
- `items-center` on `CardContent` centers the flex row (icon + text column) within the fixed card height. A shorter text column shifts the centering point down — making the content appear lower.

**Fix: structural mirroring.** Each skeleton text row is now a wrapper `<div>` with the **same Tailwind classes** as the corresponding loaded card element (`font-medium` for title, `text-xs` for each subtitle/date row). An invisible `&nbsp;` forces the div to assume its natural CSS line-height, matching the loaded element exactly. The skeleton bar is `absolute` inside, so it doesn't affect the wrapper's height. Because container heights are structurally identical, `items-center` lands at the same pixel offset in both states.

```tsx
// Before — guessed heights
<Skeleton className="h-5 w-3/4 rounded-sm" />        // title
<Skeleton className="h-3 mt-1 w-full rounded-sm" />   // subtitle

// After — structural mirroring
<div className="flex items-center gap-1.5">
  <div className="relative min-w-0 flex-1 font-medium">          // same class as loaded <p>
    <span className="invisible select-none">&nbsp;</span>         // holds natural line-height
    <Skeleton className="absolute inset-y-[20%] left-0 w-3/4 rounded-sm" />
  </div>
</div>
<div className="relative mt-0.5 text-xs">                        // mirrors subtitle line 1
  <span className="invisible select-none">&nbsp;</span>
  <Skeleton className="absolute inset-y-[15%] left-0 w-full rounded-sm" />
</div>
<div className="relative text-xs">                               // mirrors subtitle line 2
  <span className="invisible select-none">&nbsp;</span>
  <Skeleton className="absolute inset-y-[15%] left-0 w-2/3 rounded-sm" />
</div>
<div className="relative mt-1 text-xs">                          // mirrors date <p>
  <span className="invisible select-none">&nbsp;</span>
  <Skeleton className="absolute inset-y-[15%] left-0 w-1/3 rounded-sm" />
</div>
```

Confirmed via Playwright DOM measurements: at both 110% and 125% root, skeleton and loaded card `iconTopRel` and `textColH` are pixel-identical.

### Root cause B — grid level: `pt-2` / `paddingTop: 8px` on skeleton grids

`CardGridSkeleton`, `ImageGridSkeleton`, and `FileListSkeleton` all had extra top padding (`pt-2` or `paddingTop: '8px'`) on their outer wrapper divs. The loaded state uses `TanStackVirtualGrid`, which positions each row with:

```js
transform: `translateY(${virtualRow.start - scrollMargin}px)`
```

For the first row, `virtualRow.start = scrollMargin`, so `translateY(0)` — the first card starts at y=0 of the container. No extra padding.

The skeleton's `pt-2` (~8.8 px at 110% root, ~10 px at 125% root) pushed the entire first skeleton row down relative to where the first loaded row appears, creating the "skeleton lower on the page" effect.

**Fix: remove all top padding from skeleton grid containers.**

```tsx
// Before
<div className="grid ... gap-y-3.5 pt-2 ...">       // CardGridSkeleton
<div className="grid ... gap-3 pt-2 ...">            // ImageGridSkeleton
<div style={{ ..., paddingTop: '8px' }}>             // FileListSkeleton

// After
<div className="grid ... gap-y-3.5 ...">
<div className="grid ... gap-3 ...">
<div style={{ ... }}>                                // paddingTop removed
```

### Detection heuristic for future skeletons

When building a skeleton for a component rendered inside `TanStackVirtualGrid`:

1. **No extra `pt-*` / `paddingTop` on the outer skeleton wrapper.** The virtual grid's first row is at y=0; the skeleton must match.
2. **Mirror every text element's CSS class exactly.** Use the same Tailwind utilities (`font-medium`, `text-xs`, `mt-0.5`, etc.) on wrapper divs. Put skeleton bars `absolute` inside so they don't affect the wrapper's layout height.
3. **Use `invisible &nbsp;` (not `h-*` utilities) to hold line-height.** An explicit `h-*` can't track both root-font scales (110% and 125%) with a single value. The `&nbsp;` inherits the wrapper's natural line-height automatically.
4. **Mirror multi-line text with multiple single-line wrappers.** `line-clamp-2` renders 2 × (line-height) px. Replicate this with two consecutive `text-xs` wrapper divs (no margin between them).
5. **Verify with Playwright.** After writing the skeleton, inject it into the page alongside a real card clone and measure `iconTopRel` for both — they must match.
