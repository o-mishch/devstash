import { describe, it, expect } from 'vitest'
import { stripMarkdownCodeFence } from './markdown'

describe('stripMarkdownCodeFence', () => {
  it('returns plain text unchanged (trimmed)', () => {
    expect(stripMarkdownCodeFence('  hello world  ')).toBe('hello world')
  })

  it('strips a bare ``` fence', () => {
    expect(stripMarkdownCodeFence('```\nhello\n```')).toBe('hello')
  })

  it('strips a fence with any language tag', () => {
    expect(stripMarkdownCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}')
    expect(stripMarkdownCodeFence('```markdown\n# Hi\n```')).toBe('# Hi')
    expect(stripMarkdownCodeFence('```ts\nconst x = 1\n```')).toBe('const x = 1')
  })

  it('handles surrounding whitespace around the whole fenced block', () => {
    expect(stripMarkdownCodeFence('\n\n```\nhello\n```\n\n')).toBe('hello')
  })

  it('preserves multi-line inner content', () => {
    expect(stripMarkdownCodeFence('```\nline 1\nline 2\n```')).toBe('line 1\nline 2')
  })

  it('leaves an inline/partial fence untouched', () => {
    expect(stripMarkdownCodeFence('use `npm run dev` to start')).toBe('use `npm run dev` to start')
  })

  it('does not strip when only an opening fence is present', () => {
    expect(stripMarkdownCodeFence('```\nno closing fence')).toBe('```\nno closing fence')
  })
})
