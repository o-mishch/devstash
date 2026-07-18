import { itemTypeMeta } from '@/lib/item-types'

/**
 * The raw accent hex for an item-type name (the one place a CSS variable / inline color is
 * needed instead of a Tailwind class), falling back to the primary token for unknown names.
 * Sourced from the single `ITEM_TYPES` registry so the dashboard, cards, and sidebar agree.
 */
export function typeColor(name: string): string {
  return itemTypeMeta(name)?.hex ?? 'var(--primary)'
}

/**
 * The accent color of the most common item type across a set of items — used to tint a
 * widget's left border by the dominant type of its contents. Returns null for an empty set.
 */
export function dominantTypeColor(names: readonly string[]): string | null {
  const counts = names.reduce(
    (acc, name) => acc.set(name, (acc.get(name) ?? 0) + 1),
    new Map<string, number>(),
  )

  // `count > top.count` (strict) keeps the first-seen type on a tie, matching the original loop.
  const best = [...counts.entries()].reduce<{ name: string; count: number } | null>(
    (top, [name, count]) => (top === null || count > top.count ? { name, count } : top),
    null,
  )
  return best === null ? null : typeColor(best.name)
}
