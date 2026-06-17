import { describe, it, expect } from 'vitest'
import { itemCountLabel, pluralize, getTypeLabel, getTypePlural, slugToTypeName, formatDate, formatBytes, parseTagString, getFileExtension, positiveOrUndefined } from './format'

describe('formatDate', () => {
  it('formats a date as "Mon D"', () => {
    const date = new Date('2024-01-15')
    expect(formatDate(date)).toBe('Jan 15')
  })
})

describe('formatBytes', () => {
  it('formats bytes, kilobytes, and megabytes at the unit boundaries', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB')
  })
})

describe('parseTagString', () => {
  it('splits, trims, and drops empty entries', () => {
    expect(parseTagString('a, b ,, c')).toEqual(['a', 'b', 'c'])
  })

  it('returns an empty array for undefined or blank input', () => {
    expect(parseTagString(undefined)).toEqual([])
    expect(parseTagString('   ')).toEqual([])
    expect(parseTagString(',,')).toEqual([])
  })
})

describe('getFileExtension', () => {
  it('returns the lowercased extension', () => {
    expect(getFileExtension('Report.PDF')).toBe('pdf')
    expect(getFileExtension('archive.tar.gz')).toBe('gz')
  })

  it('returns empty string when there is no usable extension', () => {
    expect(getFileExtension('README')).toBe('')
    expect(getFileExtension('.gitignore')).toBe('')
    expect(getFileExtension('trailing.')).toBe('')
  })
})

describe('positiveOrUndefined', () => {
  it('returns positive numbers and drops null, zero, negative, and undefined', () => {
    expect(positiveOrUndefined(2048)).toBe(2048)
    expect(positiveOrUndefined(0)).toBeUndefined()
    expect(positiveOrUndefined(-5)).toBeUndefined()
    expect(positiveOrUndefined(null)).toBeUndefined()
    expect(positiveOrUndefined(undefined)).toBeUndefined()
  })
})

describe('pluralize', () => {
  it('returns the singular form for one', () => {
    expect(pluralize(1, 'item')).toBe('item')
  })

  it('appends "s" by default for zero and many', () => {
    expect(pluralize(0, 'item')).toBe('items')
    expect(pluralize(3, 'item')).toBe('items')
  })

  it('uses an explicit plural override when given', () => {
    expect(pluralize(2, 'entry', 'entries')).toBe('entries')
    expect(pluralize(1, 'entry', 'entries')).toBe('entry')
  })
})

describe('itemCountLabel', () => {
  it('uses the plural form for zero', () => {
    expect(itemCountLabel(0)).toBe('0 items')
  })

  it('uses the singular form for one', () => {
    expect(itemCountLabel(1)).toBe('1 item')
  })

  it('uses the plural form for more than one', () => {
    expect(itemCountLabel(5)).toBe('5 items')
  })
})

describe('getTypePlural', () => {
  it('appends s for regular nouns', () => {
    expect(getTypePlural('snippet')).toBe('snippets')
    expect(getTypePlural('prompt')).toBe('prompts')
    expect(getTypePlural('command')).toBe('commands')
    expect(getTypePlural('note')).toBe('notes')
    expect(getTypePlural('file')).toBe('files')
    expect(getTypePlural('image')).toBe('images')
    expect(getTypePlural('link')).toBe('links')
  })

  it('returns empty string for empty input', () => {
    expect(getTypePlural('')).toBe('')
  })
})

describe('getTypeLabel', () => {
  it('returns capitalised plural label for all system types', () => {
    expect(getTypeLabel('snippet')).toBe('Snippets')
    expect(getTypeLabel('prompt')).toBe('Prompts')
    expect(getTypeLabel('command')).toBe('Commands')
    expect(getTypeLabel('note')).toBe('Notes')
    expect(getTypeLabel('file')).toBe('Files')
    expect(getTypeLabel('image')).toBe('Images')
    expect(getTypeLabel('link')).toBe('Links')
  })

  it('returns empty string for empty input', () => {
    expect(getTypeLabel('')).toBe('')
  })
})

describe('slugToTypeName', () => {
  it('correctly reverses all system type slugs', () => {
    expect(slugToTypeName('snippets')).toBe('snippet')
    expect(slugToTypeName('prompts')).toBe('prompt')
    expect(slugToTypeName('commands')).toBe('command')
    expect(slugToTypeName('notes')).toBe('note')
    expect(slugToTypeName('files')).toBe('file')
    expect(slugToTypeName('images')).toBe('image')
    expect(slugToTypeName('links')).toBe('link')
  })

  it('returns the slug unchanged for unknown values', () => {
    expect(slugToTypeName('unknown')).toBe('unknown')
    expect(slugToTypeName('')).toBe('')
  })

  it('is the inverse of getTypePlural for all system types', () => {
    const types = ['snippet', 'prompt', 'command', 'note', 'file', 'image', 'link']
    for (const t of types) {
      expect(slugToTypeName(getTypePlural(t))).toBe(t)
    }
  })
})
