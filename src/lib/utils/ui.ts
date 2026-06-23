import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Label inside a button on a `@container/actionbar` row (drawer view/edit bars, parse-draft card):
// hidden by default so the button is icon-only, revealed once the container is ≥460px wide. Keeps
// every action on one line in a narrow drawer instead of wrapping/cutting. The breakpoint must clear
// the drawer's 380px min width (use-resizable `minPx`) — otherwise the row never collapses on desktop
// and the densest bar (Cancel · Save draft · Delete · Commit ≈ 425px of labels) clips its last button.
// Full literal so Tailwind's content scanner detects both utilities.
export const ACTIONBAR_LABEL_CLASS = '@[460px]/actionbar:inline hidden'

// Sizing for a button on a `@container/actionbar` row: a 44px touch target on coarse pointers, and
// flex-1 on mobile so the dense draft bar (Cancel · Save draft · Delete · Commit) shares the row
// evenly / wraps into a balanced 2×2 instead of clipping. Compose extras (e.g. text-destructive) with
// `cn(ACTIONBAR_BUTTON_CLASS, …)`.
export const ACTIONBAR_BUTTON_CLASS = 'touch:h-11 max-sm:flex-1'

// Pure column-count helpers for the virtualized item grid. Breakpoints mirror
// Tailwind's sm (640) / lg (1024) so the rendered grid matches the rest of the UI.
// list = 1/2/3 cols, image = 2/2/3 cols at <640 / <1024 / >=1024px.

export function getListGridColumns(width: number): number {
  if (width < 640) return 1
  if (width < 1024) return 2
  return 3
}

export function getImageGridColumns(width: number): number {
  if (width < 1024) return 2
  return 3
}
