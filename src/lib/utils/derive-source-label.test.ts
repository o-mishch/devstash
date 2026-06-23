import { describe, it, expect } from 'vitest'
import { deriveBrainDumpNoteTitle, deriveCollectionName } from './derive-source-label'

describe('deriveBrainDumpNoteTitle', () => {
  it('formats a readable dated label from the given date', () => {
    expect(deriveBrainDumpNoteTitle(new Date('2026-06-22T10:00:00Z'))).toBe('Brain dump Jun 22, 2026')
  })

  it('has no trailing extension so deriveCollectionName preserves it verbatim', () => {
    // Noon UTC, not midnight: the label is a local-TZ date, so a midnight-UTC fixture would roll back a
    // day (→ Jan 4) on any US-negative-offset machine and make the test flaky.
    const title = deriveBrainDumpNoteTitle(new Date('2026-01-05T12:00:00Z'))
    expect(title).toBe('Brain dump Jan 5, 2026')
    // The paste path uses the note title directly as the collection name; sanity-check it survives the
    // extension-stripping derive path too (no dot → unchanged).
    expect(deriveCollectionName(title)).toBe(title)
  })
})

describe('deriveCollectionName', () => {
  it('drops a trailing file extension', () => {
    expect(deriveCollectionName('project-notes.md')).toBe('project-notes')
    expect(deriveCollectionName('ideas.txt')).toBe('ideas')
  })

  it('keeps a dotted suffix that is not a .txt/.md extension', () => {
    // A version/decimal tail (digit-led) is not a file extension — preserve it.
    expect(deriveCollectionName('Notes 3.0')).toBe('Notes 3.0')
    expect(deriveCollectionName('release v1.2')).toBe('release v1.2')
    // Letter-led tails that aren't the source pipeline's extensions stay intact (not real filenames).
    expect(deriveCollectionName('config.prod')).toBe('config.prod')
    expect(deriveCollectionName('plan.v2')).toBe('plan.v2')
  })

  it('returns null for blank input', () => {
    expect(deriveCollectionName(null)).toBeNull()
    expect(deriveCollectionName('   ')).toBeNull()
  })
})
