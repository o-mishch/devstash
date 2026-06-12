import { describe, it, expect } from 'vitest'
import { getTypeLabel, getTypePlural, slugToTypeName } from './items'

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
