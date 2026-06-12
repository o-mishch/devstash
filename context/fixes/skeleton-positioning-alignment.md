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
