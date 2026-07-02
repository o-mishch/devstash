import { describe, it, expect } from 'vitest'
import { draftToFullItem } from './brain-dump-draft'
import type { BrainDumpDraftItem } from '@/hooks/items/use-brain-dump'

const baseDraft: BrainDumpDraftItem = {
  id: 'draft-1',
  order: 0,
  itemTypeName: 'snippet',
  title: 'My snippet',
  content: 'console.log("hi")',
  language: 'javascript',
  url: null,
  description: 'A test snippet',
  tags: ['js', 'test'],
  trashed: false,
  duplicateOf: null,
}

describe('draftToFullItem', () => {
  it('maps all editable fields from the draft', () => {
    const result = draftToFullItem(baseDraft)
    expect(result.id).toBe('draft-1')
    expect(result.title).toBe('My snippet')
    expect(result.itemType).toEqual({ name: 'snippet' })
    expect(result.content).toBe('console.log("hi")')
    expect(result.language).toBe('javascript')
    expect(result.url).toBeNull()
    expect(result.description).toBe('A test snippet')
    expect(result.tags).toEqual(['js', 'test'])
  })

  it('copies description and content into preview fields', () => {
    const result = draftToFullItem(baseDraft)
    expect(result.descriptionPreview).toBe('A test snippet')
    expect(result.contentPreview).toBe('console.log("hi")')
  })

  it('fills inert defaults for list/meta fields', () => {
    const result = draftToFullItem(baseDraft)
    expect(result.fileName).toBeNull()
    expect(result.fileSize).toBeNull()
    expect(result.isFavorite).toBe(false)
    expect(result.isPinned).toBe(false)
    expect(result.collections).toEqual([])
  })

  it('falls back to null when optional draft fields are absent', () => {
    const draft: BrainDumpDraftItem = { ...baseDraft, content: null, language: null, description: null }
    const result = draftToFullItem(draft)
    expect(result.content).toBeNull()
    expect(result.language).toBeNull()
    expect(result.description).toBeNull()
    expect(result.descriptionPreview).toBeNull()
    expect(result.contentPreview).toBeNull()
  })

  it('maps url when present', () => {
    const draft: BrainDumpDraftItem = { ...baseDraft, itemTypeName: 'link', url: 'https://example.com' }
    const result = draftToFullItem(draft)
    expect(result.url).toBe('https://example.com')
    expect(result.itemType).toEqual({ name: 'link' })
  })
})
