/**
 * Hey API generates structured query keys shaped `[{ _id: '<operationId>', ... }]`,
 * not flat string arrays. This predicate matches any generated key whose `_id` is one of
 * the given operation ids — used to invalidate/patch a whole family of queries (e.g. every
 * `listItems` variant) regardless of their query params.
 *
 * Equality, not a prefix match: `_id` is always the exact operationId, so a prefix match
 * would silently widen to any future op merely NAMED like an existing one (a `listItemsById`
 * would be swept into the `listItems` family and handed to an updater that assumes a
 * different response shape).
 */
export function heyApiKeyIs(queryKey: readonly unknown[], ...ids: string[]): boolean {
  const first = queryKey[0]
  if (typeof first === 'object' && first !== null && '_id' in first) {
    const id = first._id
    return typeof id === 'string' && ids.includes(id)
  }
  return false
}

/**
 * Whether a generated key belongs to an INFINITE query. `listItemsQueryKey` and
 * `listItemsInfiniteQueryKey` both emit `_id: 'listItems'` and are told apart only by
 * `_infinite`, so an `_id` match alone cannot tell an `InfiniteData` cache entry from a
 * plain one — a writer that assumes `.pages` needs this second check.
 */
export function heyApiKeyIsInfinite(queryKey: readonly unknown[]): boolean {
  const first = queryKey[0]
  return (
    typeof first === 'object' && first !== null && '_infinite' in first && first._infinite === true
  )
}
