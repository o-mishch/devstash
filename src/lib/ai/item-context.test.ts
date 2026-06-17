import { describe, it, expect } from 'vitest'
import { buildItemAiUserMessage } from './item-context'

describe('buildItemAiUserMessage', () => {
  it('includes file metadata for file items', () => {
    const message = buildItemAiUserMessage({
      itemType: 'file',
      title: 'Architecture',
      fileName: 'architecture.pdf',
      fileSize: 2 * 1024 * 1024,
    })

    expect(message).toContain('Item type: file')
    expect(message).toContain('Title: Architecture')
    expect(message).toContain('File name: architecture.pdf')
    expect(message).toContain('File extension: pdf')
    expect(message).toContain('File size: 2.0 MB')
  })

  it('includes image dimensions for image items', () => {
    const message = buildItemAiUserMessage({
      itemType: 'image',
      fileName: 'hero.png',
      fileSize: 512_000,
      imageWidth: 1280,
      imageHeight: 720,
    })

    expect(message).toContain('File extension: png')
    expect(message).toContain('Image dimensions: 1280 × 720 px')
  })
})
