import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

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
