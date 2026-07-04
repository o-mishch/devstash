import { vi, describe, it, expect, beforeEach } from 'vitest'
import { mockReset } from 'vitest-mock-extended'
import { matchDraftsToItems, findDuplicateMatches, type DedupCandidateItem } from './parse-dedup'
import { prisma } from '@/lib/infra/prisma'
import { asPrismaMock } from '@/test/prisma-mock'

vi.mock('@/lib/infra/prisma', async () => (await import('@/test/prisma-mock')).createPrismaMockModule())

const prismaMock = asPrismaMock(prisma)

// Element type of item.findMany's result — lets the partial fixture (with its included
// itemType relation) satisfy mockResolvedValue without an `as unknown as never` escape.
type PrismaItemRow = Awaited<ReturnType<typeof prismaMock.item.findMany>>[number]

const item = (over: Partial<DedupCandidateItem> & { id: string }): DedupCandidateItem => ({
  title: '',
  content: null,
  itemTypeName: 'note',
  ...over,
})

describe('matchDraftsToItems', () => {
  it('returns an empty map when there are no candidate items', () => {
    const result = matchDraftsToItems([{ id: 'd1', title: 'Anything', content: 'x' }], [])
    expect(result.size).toBe(0)
  })

  it('flags a draft whose normalized title equals an item title', () => {
    const result = matchDraftsToItems(
      [{ id: 'd1', title: '  Deploy   Script ', content: null }],
      [item({ id: 'i1', title: 'deploy script', itemTypeName: 'command' })],
    )
    expect(result.get('d1')).toEqual({ id: 'i1', title: 'deploy script', itemTypeName: 'command' })
  })

  it('flags a draft whose content contains the item content (and vice versa)', () => {
    const items = [item({ id: 'i1', title: 'X', content: 'const greeting = "hello"' })]
    // draft content is a superset of the item content
    const a = matchDraftsToItems(
      [{ id: 'd1', title: 'snippet', content: 'export const greeting = "hello" // note' }],
      items,
    )
    expect(a.get('d1')?.id).toBe('i1')
    // draft content is a subset of the item content
    const b = matchDraftsToItems([{ id: 'd2', title: 'z', content: 'const greeting = "hello"' }], items)
    expect(b.get('d2')?.id).toBe('i1')
  })

  it('ignores too-short content (only title can match a trivial draft)', () => {
    const items = [item({ id: 'i1', title: 'X', content: 'ok' })]
    const result = matchDraftsToItems([{ id: 'd1', title: 'unrelated', content: 'ok' }], items)
    expect(result.size).toBe(0)
  })

  it('does not flag a long draft just because it contains a trivially short item content', () => {
    // "yes" appears inside the draft text, but the item content is too short to be a meaningful match.
    const items = [item({ id: 'i1', title: 'X', content: 'yes' })]
    const result = matchDraftsToItems(
      [{ id: 'd1', title: 'unrelated', content: 'yes, deploy the staging environment first' }],
      items,
    )
    expect(result.size).toBe(0)
  })

  it('does not match unrelated drafts', () => {
    const result = matchDraftsToItems(
      [{ id: 'd1', title: 'Alpha', content: 'completely different content here' }],
      [item({ id: 'i1', title: 'Beta', content: 'nothing in common at all whatsoever' })],
    )
    expect(result.size).toBe(0)
  })

  it('matches title case-insensitively and collapses whitespace', () => {
    const result = matchDraftsToItems(
      [{ id: 'd1', title: 'GIT\tReset   Hard', content: null }],
      [item({ id: 'i1', title: 'git reset hard' })],
    )
    expect(result.get('d1')?.id).toBe('i1')
  })

  it('returns the first matching item when several would match', () => {
    const items = [
      item({ id: 'i1', title: 'dup' }),
      item({ id: 'i2', title: 'dup' }),
    ]
    const result = matchDraftsToItems([{ id: 'd1', title: 'dup', content: null }], items)
    expect(result.get('d1')?.id).toBe('i1')
  })

  it('does not flag a draft with an empty title and no matchable content', () => {
    const result = matchDraftsToItems(
      [{ id: 'd1', title: '', content: null }],
      [item({ id: 'i1', title: '', content: 'something' })],
    )
    expect(result.size).toBe(0)
  })
})

describe('findDuplicateMatches', () => {
  beforeEach(() => mockReset(prismaMock))

  it('returns an empty map (and skips the query) when there are no drafts', async () => {
    const result = await findDuplicateMatches('u1', [], null)
    expect(result.size).toBe(0)
    expect(prismaMock.item.findMany).not.toHaveBeenCalled()
  })

  it('queries IDOR-scoped, bounded, newest-first', async () => {
    prismaMock.item.findMany.mockResolvedValue([])
    await findDuplicateMatches('u1', [{ id: 'd1', title: 'x', content: null }], null)
    expect(prismaMock.item.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u1' },
        take: 500,
        orderBy: { updatedAt: 'desc' },
      }),
    )
  })

  it('excludes the job source item so paste/select drafts do not all match their source text', async () => {
    prismaMock.item.findMany.mockResolvedValue([])
    await findDuplicateMatches('u1', [{ id: 'd1', title: 'x', content: 'export const a = 1' }], 'src-item')
    expect(prismaMock.item.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', id: { not: 'src-item' } } }),
    )
  })

  it('maps committed items through the matcher and resolves the item type name', async () => {
    // Runtime shape includes the itemType relation the production query selects, which the
    // default findMany return type omits — so bridge through unknown to the row type.
    prismaMock.item.findMany.mockResolvedValue([
      { id: 'i1', title: 'Deploy Script', content: null, itemType: { name: 'command' } } as unknown as PrismaItemRow,
    ])
    const result = await findDuplicateMatches('u1', [{ id: 'd1', title: 'deploy script', content: null }], null)
    expect(result.get('d1')).toEqual({ id: 'i1', title: 'Deploy Script', itemTypeName: 'command' })
  })
})
