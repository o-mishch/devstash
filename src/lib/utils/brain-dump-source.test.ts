import { describe, it, expect } from 'vitest'
import { isParseSourceEligible } from './brain-dump-source'

describe('isParseSourceEligible', () => {
  it('accepts a note tagged brain-dump regardless of fileName', () => {
    expect(isParseSourceEligible({ itemType: { name: 'note' }, fileName: null, tags: ['brain-dump'] })).toBe(true)
    expect(
      isParseSourceEligible({ itemType: { name: 'note' }, fileName: 'whatever.bin', tags: ['foo', 'brain-dump'] }),
    ).toBe(true)
  })

  it('rejects a note without the brain-dump tag', () => {
    expect(isParseSourceEligible({ itemType: { name: 'note' }, fileName: null, tags: [] })).toBe(false)
    expect(isParseSourceEligible({ itemType: { name: 'note' }, fileName: null, tags: ['notes', 'todo'] })).toBe(false)
  })

  it('accepts a .txt or .md file tagged brain-dump', () => {
    expect(isParseSourceEligible({ itemType: { name: 'file' }, fileName: 'notes.txt', tags: ['brain-dump'] })).toBe(true)
    expect(isParseSourceEligible({ itemType: { name: 'file' }, fileName: 'README.md', tags: ['x', 'brain-dump'] })).toBe(true)
  })

  it('rejects a text file without the brain-dump tag', () => {
    expect(isParseSourceEligible({ itemType: { name: 'file' }, fileName: 'notes.txt', tags: [] })).toBe(false)
    expect(isParseSourceEligible({ itemType: { name: 'file' }, fileName: 'README.md', tags: ['docs'] })).toBe(false)
  })

  it('matches the extension case-insensitively', () => {
    expect(isParseSourceEligible({ itemType: { name: 'file' }, fileName: 'NOTES.TXT', tags: ['brain-dump'] })).toBe(true)
    expect(isParseSourceEligible({ itemType: { name: 'file' }, fileName: 'Doc.MD', tags: ['brain-dump'] })).toBe(true)
  })

  it('rejects a tagged file with a non-text extension', () => {
    expect(isParseSourceEligible({ itemType: { name: 'file' }, fileName: 'data.pdf', tags: ['brain-dump'] })).toBe(false)
    expect(isParseSourceEligible({ itemType: { name: 'file' }, fileName: 'archive.zip', tags: ['brain-dump'] })).toBe(false)
  })

  it('rejects a tagged file with no name or no extension', () => {
    expect(isParseSourceEligible({ itemType: { name: 'file' }, fileName: null, tags: ['brain-dump'] })).toBe(false)
    expect(isParseSourceEligible({ itemType: { name: 'file' }, fileName: 'Makefile', tags: ['brain-dump'] })).toBe(false)
  })

  it('rejects non-note, non-file types', () => {
    expect(isParseSourceEligible({ itemType: { name: 'snippet' }, fileName: null, tags: ['brain-dump'] })).toBe(false)
    expect(isParseSourceEligible({ itemType: { name: 'image' }, fileName: 'pic.txt', tags: [] })).toBe(false)
    expect(isParseSourceEligible({ itemType: { name: 'link' }, fileName: null, tags: ['brain-dump'] })).toBe(false)
  })
})
