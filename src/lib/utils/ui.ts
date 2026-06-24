import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Label inside a button on a `@container/actionbar` row (drawer view/edit bars, parse-draft card):
// hidden by default so the button is icon-only, revealed once the container is wide enough. Labels
// reveal progressively by position from the LEFT — the leftmost button at the smallest width, each
// one to its right at a larger one — so as the drawer narrows the labels collapse to icon-only ONE
// AT A TIME starting from the rightmost button, never all-or-nothing. Thresholds stay above the
// drawer's 380px min width (use-resizable `minPx`) so the densest bar (Cancel · Save draft · Delete ·
// Commit ≈ 425px of labels) still collapses on a narrow desktop drawer instead of clipping, and the
// widest (510px) is reachable at the 560px default width. Full literals so Tailwind's content scanner
// detects every utility.
const ACTIONBAR_LABEL_CLASSES = [
  '@[230px]/actionbar:inline hidden',
  '@[300px]/actionbar:inline hidden',
  '@[370px]/actionbar:inline hidden',
  '@[440px]/actionbar:inline hidden',
  '@[510px]/actionbar:inline hidden',
] as const

// Label class for the action-bar button at `indexFromLeft` (0 = leftmost). Clamps to both ends so an
// out-of-range index (past the array end, or negative) still resolves to a valid threshold class.
export function actionbarLabelClass(indexFromLeft: number): string {
  const index = Math.min(Math.max(indexFromLeft, 0), ACTIONBAR_LABEL_CLASSES.length - 1)
  return ACTIONBAR_LABEL_CLASSES[index]
}

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
