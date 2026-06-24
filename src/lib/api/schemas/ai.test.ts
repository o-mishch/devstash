import { describe, it, expect } from 'vitest'
import { brainDumpInput, brainDumpItemPatchInput, brainDumpSourceQuery } from './ai'
import {
  SPLIT_FILE_MAX_INPUT_CHARS,
  SPLIT_FILE_MIN_INPUT_CHARS,
  SPLIT_FILE_MAX_PASTE_BYTES,
} from '@/lib/utils/constants'

// Backstops the splitter's request contract: the v1 one-of (text|sourceItemId), the paste byte cap +
// non-blank minimum (a long paste is accepted WHOLE — the parse window is sliced server-side), and the
// reclassify type constraint that keeps file/image drafts off the board.

describe('brainDumpInput', () => {
  it('accepts a long paste whole, not clamped to the parse window (the server slices it)', () => {
    const long = 'a'.repeat(SPLIT_FILE_MAX_INPUT_CHARS + 500)
    const parsed = brainDumpInput.parse({ text: long })
    expect(parsed.text?.length).toBe(SPLIT_FILE_MAX_INPUT_CHARS + 500)
  })

  it('counts only non-blank characters toward the minimum', () => {
    expect(brainDumpInput.safeParse({ text: 'a '.repeat(SPLIT_FILE_MIN_INPUT_CHARS - 1) }).success).toBe(false)
    expect(brainDumpInput.safeParse({ text: 'a'.repeat(SPLIT_FILE_MIN_INPUT_CHARS) }).success).toBe(true)
  })

  it('rejects a paste over the ~1 MB byte cap', () => {
    expect(brainDumpInput.safeParse({ text: 'a'.repeat(SPLIT_FILE_MAX_PASTE_BYTES + 1) }).success).toBe(false)
  })

  it('accepts exactly one of text or sourceItemId', () => {
    expect(brainDumpInput.safeParse({ sourceItemId: 'itm_1' }).success).toBe(true)
    expect(brainDumpInput.safeParse({}).success).toBe(false)
    expect(
      brainDumpInput.safeParse({ text: 'a'.repeat(SPLIT_FILE_MIN_INPUT_CHARS), sourceItemId: 'itm_1' }).success,
    ).toBe(false)
  })
})

describe('brainDumpSourceQuery', () => {
  it('defaults to file sources and accepts content sources', () => {
    expect(brainDumpSourceQuery.parse({})).toEqual({ type: 'file' })
    expect(brainDumpSourceQuery.safeParse({ type: 'content' }).success).toBe(true)
  })

  it('rejects the old note-only source kind', () => {
    expect(brainDumpSourceQuery.safeParse({ type: 'note' }).success).toBe(false)
  })
})

describe('brainDumpItemPatchInput', () => {
  it('rejects reclassifying a draft to a non-text (file/image) type', () => {
    expect(brainDumpItemPatchInput.safeParse({ itemTypeName: 'file' }).success).toBe(false)
    expect(brainDumpItemPatchInput.safeParse({ itemTypeName: 'image' }).success).toBe(false)
  })

  it('accepts each of the five text buckets', () => {
    const buckets = ['snippet', 'command', 'prompt', 'note', 'link']
    buckets.forEach((itemTypeName) => {
      expect(brainDumpItemPatchInput.safeParse({ itemTypeName }).success).toBe(true)
    })
  })

  it('requires at least one field', () => {
    expect(brainDumpItemPatchInput.safeParse({}).success).toBe(false)
  })
})
