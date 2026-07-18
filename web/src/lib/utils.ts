import type { Ref } from 'react'
import { clsx } from 'clsx'
import type { ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merge conditional class names, de-duplicating conflicting Tailwind utilities. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/**
 * Combine several refs (callback or object) into one callback ref, so a node can be
 * forwarded to a local `useRef` and a hook's callback ref at once — instead of
 * hand-writing the same assign-then-forward closure per component.
 */
export function mergeRefs<T>(...refs: (Ref<T> | undefined)[]): (node: T | null) => void {
  return (node) => {
    refs.forEach((ref) => {
      if (typeof ref === 'function') {
        ref(node)
      } else if (ref != null) {
        ref.current = node
      }
    })
  }
}

/** Shared card surface (border, background, hover) for the item and collection cards. */
export const CARD_SURFACE =
  'rounded-xl border border-border bg-card p-4 transition-colors hover:border-muted-foreground/30'

/** True when a value is a present, non-blank string (whitespace-only counts as blank). */
export function hasText(value: string | null | undefined): value is string {
  return value != null && value.trim() !== ''
}

/**
 * Read an env var, treating a defined-but-empty `""` (e.g. a blank CI substitution) as
 * absent so a `??` fallback fires. Shared so the api-base-url and site-url overrides — which
 * both depend on this exact coercion — can't drift.
 */
export function envString(value: string | undefined): string | undefined {
  return value === '' ? undefined : value
}

/** Toast copy for a favorite toggle — shared so item and collection favorites can't drift. */
export function favoriteToggleMessage(isFavorite: boolean): string {
  return isFavorite ? 'Added to favorites' : 'Removed from favorites'
}
