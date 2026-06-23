// The saved-note / new-collection title for a PASTED Brain Dump source: a dated, human-readable label
// ("Brain dump Jun 22, 2026") rather than the first pasted line — a paste has no intrinsic name, so a
// date makes the saved note recognizable in the stash and gives the new collection a clean default.
// `now` is injectable for deterministic tests.
export function deriveBrainDumpNoteTitle(now: Date = new Date()): string {
  const date = now.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  return `Brain dump ${date}`
}

// Seeds the default new-collection name from a source label, dropping a trailing file extension.
// Anchored to the only extensions the source pipeline actually produces (`.txt`/`.md`, per getSourceText)
// so a dotted label that isn't a parseable filename — "Notes 3.0", "config.prod", "plan.v2" — keeps its
// trailing token instead of being truncated. createParseJob slices to COLLECTION_NAME_MAX_CHARS, so no
// slice here.
export function deriveCollectionName(sourceName: string | null): string | null {
  return sourceName?.replace(/\.(txt|md)$/i, '').trim() || null
}
