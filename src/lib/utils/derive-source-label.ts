/** First non-blank line as a label, capped; fallback to a timestamped name for blank-ish content. */
export function deriveSourceLabel(text: string, maxChars: number): string {
  const firstLine = text.split('\n').find((line) => line.trim().length > 0)?.trim()
  return firstLine ? firstLine.slice(0, maxChars) : `brain-dump-${Date.now()}`
}

// Seeds the default new-collection name from a source label, dropping a trailing file extension.
// createParseJob slices to COLLECTION_NAME_MAX_CHARS when seeding, so no slice here.
export function deriveCollectionName(sourceName: string | null): string | null {
  return sourceName?.replace(/\.[^.]+$/, '').trim() || null
}
