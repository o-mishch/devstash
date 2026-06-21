import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/infra/prisma', () => {
  const prisma = {
    aiParseJob: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    aiParseJobItem: { create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    item: { findFirst: vi.fn(), findMany: vi.fn() },
    collection: { create: vi.fn(), findMany: vi.fn() },
    // Interactive transaction: invoke the callback with the same mock client so per-table mocks
    // configured in a test flow through the `tx` handle (claim/create/persist run atomically in prod).
    $transaction: vi.fn((callback: (tx: unknown) => unknown) => callback(prisma)),
  }
  return { prisma }
})
vi.mock('@/lib/db/items', () => ({ createItem: vi.fn() }))
vi.mock('@/lib/storage/s3', () => ({ getTextFromS3: vi.fn() }))
vi.mock('@/lib/infra/pino', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}))

import { prisma } from '@/lib/infra/prisma'
import { createItem } from '@/lib/db/items'
import { getTextFromS3 } from '@/lib/storage/s3'
import {
  commitJob,
  commitDraftItem,
  getParseJobSnapshot,
  getParseJobRunState,
  appendDraftsAndAdvance,
  updateStreamCursor,
  emptyJobTrash,
  updateJobCollections,
  createParseJob,
  deleteJob,
  getSourceText,
  listParseSourceCandidates,
  listActiveParseJobs,
  type ParseSourceItem,
} from '@/lib/db/ai-parse-jobs'
import { SPLIT_FILE_MAX_INPUT_CHARS } from '@/lib/utils/constants'
import { brainDumpProgress, type BrainDumpDraft } from '@/lib/ai/brain-dump'

const mockJob = prisma.aiParseJob as unknown as {
  findFirst: ReturnType<typeof vi.fn>
  deleteMany: ReturnType<typeof vi.fn>
}
const mockJobItem = prisma.aiParseJobItem as unknown as {
  create: ReturnType<typeof vi.fn>
  deleteMany: ReturnType<typeof vi.fn>
  updateMany: ReturnType<typeof vi.fn>
  findFirst: ReturnType<typeof vi.fn>
}
const mockJobUpdate = prisma.aiParseJob as unknown as { updateMany: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> }
const mockItem = prisma.item as unknown as { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> }
const mockCollection = prisma.collection as unknown as { create: ReturnType<typeof vi.fn> }
const mockCreateItem = createItem as ReturnType<typeof vi.fn>
const mockGetTextFromS3 = getTextFromS3 as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
})

describe('commitJob', () => {
  it('maps each draft to createItem with the right per-type fields, then deletes the job', async () => {
    mockJob.findFirst.mockResolvedValue({
      status: 'completed',
      collectionName: null,
      collectionIds: [],
      items: [
        { id: 'd1', order: 0, itemTypeName: 'snippet', title: 'S', content: 'code', url: null, language: 'ts', description: 'desc', tags: ['a'] },
        { id: 'd2', order: 1, itemTypeName: 'link', title: 'L', content: null, url: 'https://x.dev', language: null, description: null, tags: [] },
      ],
    })
    mockCreateItem.mockResolvedValue({ id: 'real' })
    mockJob.deleteMany.mockResolvedValue({ count: 1 })

    const result = await commitJob('user-1', 'job-1')

    expect(result).toEqual({ kind: 'done', created: 2, total: 2 })
    // IDOR-scoped read: job fetched by id AND userId.
    expect(mockJob.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'job-1', userId: 'user-1' } }))
    expect(mockCreateItem).toHaveBeenCalledWith('user-1', expect.objectContaining({
      itemTypeName: 'snippet', content: 'code', language: 'ts', url: null, fileUrl: null, collectionIds: [],
    }))
    expect(mockCreateItem).toHaveBeenCalledWith('user-1', expect.objectContaining({
      itemTypeName: 'link', url: 'https://x.dev', content: null,
    }))
    expect(mockJob.deleteMany).toHaveBeenCalledWith({ where: { id: 'job-1', userId: 'user-1' } })
  })

  it('excludes trashed drafts from the commit (only non-trashed are read)', async () => {
    mockJob.findFirst.mockResolvedValue({ status: 'completed', collectionName: null, collectionIds: [], items: [] })
    mockJob.deleteMany.mockResolvedValue({ count: 1 })

    await commitJob('user-1', 'job-1')

    expect(mockJob.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          items: expect.objectContaining({ where: { trashed: false } }),
        }),
      }),
    )
  })

  it('creates a new collection from the job name and attaches every item to it + existing ids', async () => {
    mockJob.findFirst.mockResolvedValue({
      status: 'completed',
      collectionName: 'Project X',
      collectionIds: ['col-existing'],
      items: [
        { id: 'd1', order: 0, itemTypeName: 'note', title: 'A', content: 'a', url: null, language: null, description: null, tags: [] },
      ],
    })
    mockJobUpdate.updateMany.mockResolvedValue({ count: 1 }) // wins the new-collection claim
    mockCollection.create.mockResolvedValue({ id: 'col-new' })
    mockCreateItem.mockResolvedValue({ id: 'real' })
    mockJob.deleteMany.mockResolvedValue({ count: 1 })

    await commitJob('user-1', 'job-1')

    // Claim → create → persist run inside one $transaction (atomic against a concurrent Save now).
    expect(prisma.$transaction).toHaveBeenCalled()
    expect(mockCollection.create).toHaveBeenCalledWith({
      data: { userId: 'user-1', name: 'Project X' },
      select: { id: true },
    })
    // Items join the union of the existing collection + the newly created one.
    expect(mockCreateItem).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ collectionIds: ['col-existing', 'col-new'] }),
    )
  })

  it('creates no collection when the job has no name (only existing ids are attached)', async () => {
    mockJob.findFirst.mockResolvedValue({
      status: 'completed',
      collectionName: null,
      collectionIds: ['col-a'],
      items: [
        { id: 'd1', order: 0, itemTypeName: 'note', title: 'A', content: 'a', url: null, language: null, description: null, tags: [] },
      ],
    })
    mockCreateItem.mockResolvedValue({ id: 'real' })
    mockJob.deleteMany.mockResolvedValue({ count: 1 })

    await commitJob('user-1', 'job-1')

    expect(mockCollection.create).not.toHaveBeenCalled()
    expect(mockCreateItem).toHaveBeenCalledWith('user-1', expect.objectContaining({ collectionIds: ['col-a'] }))
  })

  it('counts only successful creates', async () => {
    mockJob.findFirst.mockResolvedValue({
      status: 'completed',
      collectionName: null,
      collectionIds: [],
      items: [
        { id: 'd1', order: 0, itemTypeName: 'note', title: 'A', content: 'a', url: null, language: null, description: null, tags: [] },
        { id: 'd2', order: 1, itemTypeName: 'note', title: 'B', content: 'b', url: null, language: null, description: null, tags: [] },
      ],
    })
    mockCreateItem.mockResolvedValueOnce({ id: 'real' }).mockResolvedValueOnce(null)
    mockJob.deleteMany.mockResolvedValue({ count: 1 })

    expect(await commitJob('user-1', 'job-1')).toEqual({ kind: 'done', created: 1, total: 2 })
  })

  it('deletes each committed draft as it saves, and keeps the job on a partial failure (no data loss)', async () => {
    mockJob.findFirst.mockResolvedValue({
      status: 'completed',
      collectionName: null,
      collectionIds: [],
      items: [
        { id: 'd1', order: 0, itemTypeName: 'note', title: 'A', content: 'a', url: null, language: null, description: null, tags: [] },
        { id: 'd2', order: 1, itemTypeName: 'note', title: 'B', content: 'b', url: null, language: null, description: null, tags: [] },
      ],
    })
    // d1 commits, d2 fails — the failed draft must survive for retry.
    mockCreateItem.mockResolvedValueOnce({ id: 'real' }).mockResolvedValueOnce(null)

    const result = await commitJob('user-1', 'job-1')

    expect(result).toEqual({ kind: 'done', created: 1, total: 2 })
    // Committed draft deleted as it is saved (bounds the crash window to one draft); failed one kept.
    expect(mockJobItem.deleteMany).toHaveBeenCalledWith({ where: { id: 'd1', userId: 'user-1' } })
    expect(mockJobItem.deleteMany).not.toHaveBeenCalledWith({ where: { id: 'd2', userId: 'user-1' } })
    // Job NOT removed on a partial commit — that would discard the un-saved draft.
    expect(mockJob.deleteMany).not.toHaveBeenCalled()
  })

  it('returns null and creates nothing when the job is not the user\'s (IDOR)', async () => {
    mockJob.findFirst.mockResolvedValue(null)

    expect(await commitJob('user-1', 'job-x')).toEqual({ kind: 'not_found' })
    expect(mockCreateItem).not.toHaveBeenCalled()
    expect(mockJob.deleteMany).not.toHaveBeenCalled()
  })
})

describe('commitDraftItem', () => {
  const draft = {
    id: 'd1', order: 0, itemTypeName: 'note', title: 'A', content: 'a',
    url: null, language: null, description: null, tags: [], trashed: false,
  }

  it('returns null (404) when the draft is not the user\'s or is trashed (IDOR)', async () => {
    mockJobItem.findFirst.mockResolvedValue(null)

    expect(await commitDraftItem('user-1', 'job-1', 'item-x')).toBeNull()
    expect(mockJobItem.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'item-x', jobId: 'job-1', userId: 'user-1', trashed: false } }),
    )
    expect(mockCreateItem).not.toHaveBeenCalled()
  })

  it('attaches the job\'s existing collections, creates the item, and deletes the draft (1)', async () => {
    mockJobItem.findFirst.mockResolvedValue(draft)
    mockJob.findFirst.mockResolvedValue({ collectionName: null, collectionIds: ['col-a'] })
    mockCreateItem.mockResolvedValue({ id: 'real' })
    mockJobItem.deleteMany.mockResolvedValue({ count: 1 })

    expect(await commitDraftItem('user-1', 'job-1', 'd1')).toBe(1)
    expect(mockCollection.create).not.toHaveBeenCalled()
    expect(mockCreateItem).toHaveBeenCalledWith('user-1', expect.objectContaining({ itemTypeName: 'note', collectionIds: ['col-a'] }))
    expect(mockJobItem.deleteMany).toHaveBeenCalledWith({ where: { id: 'd1', userId: 'user-1' } })
  })

  it('wins the claim: creates the new collection once and persists its id (no duplicate)', async () => {
    mockJobItem.findFirst.mockResolvedValue(draft)
    mockJob.findFirst.mockResolvedValue({ collectionName: 'Project X', collectionIds: ['col-a'] })
    mockJobUpdate.updateMany.mockResolvedValue({ count: 1 }) // wins the guarded claim
    mockCollection.create.mockResolvedValue({ id: 'col-new' })
    mockCreateItem.mockResolvedValue({ id: 'real' })
    mockJobItem.deleteMany.mockResolvedValue({ count: 1 })

    expect(await commitDraftItem('user-1', 'job-1', 'd1')).toBe(1)
    // Claim → create → persist run inside ONE $transaction so the row stays locked until the new id
    // is written (a concurrent Save now can never attach to a stale collectionIds set).
    expect(prisma.$transaction).toHaveBeenCalled()
    // Atomically claims the name (guarded by the current collectionName) before creating the collection.
    expect(mockJobUpdate.updateMany).toHaveBeenCalledWith({
      where: { id: 'job-1', userId: 'user-1', collectionName: 'Project X' },
      data: { collectionName: null },
    })
    expect(mockCollection.create).toHaveBeenCalledWith({
      data: { userId: 'user-1', name: 'Project X' },
      select: { id: true },
    })
    // Then persists the new id so later saves/commit reuse it.
    expect(mockJobUpdate.updateMany).toHaveBeenCalledWith({
      where: { id: 'job-1', userId: 'user-1' },
      data: { collectionIds: ['col-a', 'col-new'] },
    })
    expect(mockCreateItem).toHaveBeenCalledWith('user-1', expect.objectContaining({ collectionIds: ['col-a', 'col-new'] }))
  })

  it('loses the claim: skips creation and reuses the winner\'s persisted id (no duplicate)', async () => {
    mockJobItem.findFirst.mockResolvedValue(draft)
    mockJob.findFirst
      .mockResolvedValueOnce({ collectionName: 'Project X', collectionIds: ['col-a'] }) // initial read
      .mockResolvedValueOnce({ collectionIds: ['col-a', 'col-new'] }) // re-read after the lost claim
    mockJobUpdate.updateMany.mockResolvedValue({ count: 0 }) // a concurrent save already claimed it
    mockCreateItem.mockResolvedValue({ id: 'real' })
    mockJobItem.deleteMany.mockResolvedValue({ count: 1 })

    expect(await commitDraftItem('user-1', 'job-1', 'd1')).toBe(1)
    expect(mockCollection.create).not.toHaveBeenCalled()
    expect(mockCreateItem).toHaveBeenCalledWith('user-1', expect.objectContaining({ collectionIds: ['col-a', 'col-new'] }))
  })

  it('keeps the draft when createItem fails (0)', async () => {
    mockJobItem.findFirst.mockResolvedValue(draft)
    mockJob.findFirst.mockResolvedValue({ collectionName: null, collectionIds: [] })
    mockCreateItem.mockResolvedValue(null)

    expect(await commitDraftItem('user-1', 'job-1', 'd1')).toBe(0)
    expect(mockJobItem.deleteMany).not.toHaveBeenCalled()
  })
})

describe('emptyJobTrash', () => {
  it('permanently deletes only the trashed drafts of an owned job, scoped to the user (IDOR)', async () => {
    mockJob.findFirst.mockResolvedValue({ id: 'job-1' })
    mockJobItem.deleteMany.mockResolvedValue({ count: 3 })

    const deleted = await emptyJobTrash('user-1', 'job-1')

    expect(deleted).toBe(3)
    expect(mockJobItem.deleteMany).toHaveBeenCalledWith({
      where: { jobId: 'job-1', userId: 'user-1', trashed: true },
    })
  })

  it('returns null and deletes nothing when the job is not the user\'s (so the route 404s)', async () => {
    mockJob.findFirst.mockResolvedValue(null)

    expect(await emptyJobTrash('user-1', 'job-x')).toBeNull()
    expect(mockJobItem.deleteMany).not.toHaveBeenCalled()
  })
})

describe('appendDraftsAndAdvance', () => {
  const draft = (over: Partial<BrainDumpDraft> = {}): BrainDumpDraft => ({
    itemTypeName: 'note',
    title: 'T',
    content: 'c',
    url: null,
    language: null,
    description: null,
    tags: [],
    ...over,
  })

  it('persists drafts + cursor + progress in ONE transaction, with sequential order from startOrder', async () => {
    mockJobItem.create.mockImplementation(({ data }: { data: { order: number } }) =>
      Promise.resolve({ id: `row-${data.order}`, order: data.order, itemTypeName: 'note', title: 'T', content: 'c', url: null, language: null, description: null, tags: [], trashed: false }),
    )
    mockJobUpdate.updateMany.mockResolvedValue({ count: 1 })

    const saved = await appendDraftsAndAdvance('user-1', 'job-1', [draft({ title: 'A' }), draft({ title: 'B' })], 5, 42)

    // All writes go through the single $transaction (drafts + cursor commit together — resume safety).
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(saved.map((row) => row.order)).toEqual([5, 6])
    expect(mockJobItem.create).toHaveBeenCalledTimes(2)
    expect(mockJobItem.create).toHaveBeenNthCalledWith(1, expect.objectContaining({ data: expect.objectContaining({ jobId: 'job-1', userId: 'user-1', order: 5 }) }))
    // Progress + cursor advance together with the draft writes.
    expect(mockJobUpdate.updateMany).toHaveBeenCalledWith({
      where: { id: 'job-1', userId: 'user-1' },
      data: { progress: brainDumpProgress(7), streamCursor: 42 },
    })
  })

  it('advances the cursor only (no writes) for an empty boundary batch', async () => {
    const saved = await appendDraftsAndAdvance('user-1', 'job-1', [], 5, 99)

    expect(saved).toEqual([])
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(mockJobItem.create).not.toHaveBeenCalled()
    expect(mockJobUpdate.updateMany).toHaveBeenCalledWith({
      where: { id: 'job-1', userId: 'user-1' },
      data: { streamCursor: 99 },
    })
  })

  it('does nothing for an empty batch with a null cursor (terminal trailing flush)', async () => {
    const saved = await appendDraftsAndAdvance('user-1', 'job-1', [], 5, null)

    expect(saved).toEqual([])
    expect(mockJobUpdate.updateMany).not.toHaveBeenCalled()
  })

  it('omits the cursor from the update when null (progress-only terminal batch)', async () => {
    mockJobItem.create.mockResolvedValue({ id: 'row-0', order: 0, itemTypeName: 'note', title: 'T', content: 'c', url: null, language: null, description: null, tags: [], trashed: false })
    mockJobUpdate.updateMany.mockResolvedValue({ count: 1 })

    await appendDraftsAndAdvance('user-1', 'job-1', [draft()], 0, null)

    expect(mockJobUpdate.updateMany).toHaveBeenCalledWith({
      where: { id: 'job-1', userId: 'user-1' },
      data: { progress: brainDumpProgress(1) },
    })
  })
})

describe('getParseJobRunState', () => {
  it('is IDOR-scoped and returns null when the job is not the user\'s', async () => {
    mockJob.findFirst.mockResolvedValue(null)
    expect(await getParseJobRunState('user-1', 'job-x')).toBeNull()
    expect(mockJob.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'job-x', userId: 'user-1' } }))
  })

  it('maps the run state including the persisted item count', async () => {
    mockJob.findFirst.mockResolvedValue({
      status: 'processing',
      sourceText: 'window',
      openaiResponseId: 'resp_1',
      streamCursor: 7,
      _count: { items: 3 },
    })
    expect(await getParseJobRunState('user-1', 'job-1')).toEqual({
      status: 'processing',
      sourceText: 'window',
      openaiResponseId: 'resp_1',
      streamCursor: 7,
      itemCount: 3,
    })
  })
})

describe('updateStreamCursor', () => {
  it('advances the cursor scoped to the user (IDOR)', async () => {
    mockJobUpdate.updateMany.mockResolvedValue({ count: 1 })
    await updateStreamCursor('user-1', 'job-1', 12)
    expect(mockJobUpdate.updateMany).toHaveBeenCalledWith({
      where: { id: 'job-1', userId: 'user-1' },
      data: { streamCursor: 12 },
    })
  })
})

describe('updateJobCollections', () => {
  it('clamps/trims a new collection name and validates collection ownership', async () => {
    const mockCollectionFindMany = prisma.collection.findMany as ReturnType<typeof vi.fn>
    mockCollectionFindMany.mockResolvedValue([{ id: 'c1' }])
    mockJobUpdate.updateMany.mockResolvedValue({ count: 1 })

    const ok = await updateJobCollections('user-1', 'job-1', { collectionName: '  My collection  ', collectionIds: ['c1'] })

    expect(ok).toBe('ok')
    expect(mockJobUpdate.updateMany).toHaveBeenCalledWith({
      where: { id: 'job-1', userId: 'user-1' },
      data: { collectionName: 'My collection', collectionIds: ['c1'] },
    })
  })

  it('stores null when the name is cleared', async () => {
    mockJobUpdate.updateMany.mockResolvedValue({ count: 1 })

    await updateJobCollections('user-1', 'job-1', { collectionName: '   ' })

    expect(mockJobUpdate.updateMany).toHaveBeenCalledWith({
      where: { id: 'job-1', userId: 'user-1' },
      data: { collectionName: null },
    })
  })

  it('returns invalid_collections when an id is not owned by the user', async () => {
    const mockCollectionFindMany = prisma.collection.findMany as ReturnType<typeof vi.fn>
    mockCollectionFindMany.mockResolvedValue([])
    expect(await updateJobCollections('user-1', 'job-1', { collectionIds: ['foreign'] })).toBe('invalid_collections')
    expect(mockJobUpdate.updateMany).not.toHaveBeenCalled()
  })

  it('returns not_found when the job is not the user\'s (IDOR)', async () => {
    mockJobUpdate.updateMany.mockResolvedValue({ count: 0 })
    expect(await updateJobCollections('user-1', 'job-x', { collectionIds: [] })).toBe('not_found')
  })
})

describe('listActiveParseJobs', () => {
  it('includes processing jobs and completed jobs with committable drafts', async () => {
    const mockFindMany = prisma.aiParseJob.findMany as ReturnType<typeof vi.fn>
    mockFindMany.mockResolvedValue([
      { id: 'j1', status: 'processing', progress: 40, sourceName: 'a.md', createdAt: new Date('2026-01-01'), _count: { items: 2 } },
      { id: 'j2', status: 'completed', progress: 100, sourceName: 'b.txt', createdAt: new Date('2026-01-02'), _count: { items: 3 } },
    ])

    const jobs = await listActiveParseJobs('user-1')

    expect(jobs).toHaveLength(2)
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-1',
          OR: expect.arrayContaining([
            { status: 'processing' },
            { status: 'completed', items: { some: { trashed: false } } },
          ]),
        }),
      }),
    )
  })
})

describe('commitJob while processing', () => {
  it('returns still_processing without creating items', async () => {
    mockJob.findFirst.mockResolvedValue({ status: 'processing', items: [] })
    expect(await commitJob('user-1', 'job-1')).toEqual({ kind: 'still_processing' })
    expect(mockCreateItem).not.toHaveBeenCalled()
  })
})

describe('getParseJobSnapshot', () => {
  it('is IDOR-scoped and returns null when the job is not the user\'s', async () => {
    mockJob.findFirst.mockResolvedValue(null)
    expect(await getParseJobSnapshot('user-1', 'job-x')).toBeNull()
    expect(mockJob.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'job-x', userId: 'user-1' } }))
  })

  it('returns the typed snapshot for an owned job (incl. source fields)', async () => {
    mockJob.findFirst.mockResolvedValue({
      status: 'completed',
      progress: 100,
      error: null,
      collectionName: null,
      collectionIds: [],
      sourceItemId: 'note-1',
      sourceName: 'notes.md',
      truncated: true,
      sourceItem: { itemType: { name: 'note' } },
      items: [{ id: 'd1', order: 0, itemTypeName: 'note', title: 'A', content: 'a', url: null, language: null, description: null, tags: [] }],
    })
    const snap = await getParseJobSnapshot('user-1', 'job-1')
    expect(snap).toMatchObject({
      status: 'completed',
      sourceItemId: 'note-1',
      sourceItemType: 'note',
      sourceName: 'notes.md',
      truncated: true,
      items: [{ id: 'd1' }],
    })
  })
})

describe('createParseJob', () => {
  it('persists the source linkage (sourceItemId / sourceName / truncated) + seeded collection name', async () => {
    mockJobUpdate.create.mockResolvedValue({ id: 'job-1' })
    const id = await createParseJob('user-1', {
      sourceText: 'window',
      sourceItemId: 'note-1',
      sourceName: 'notes.md',
      truncated: true,
      collectionName: 'notes',
    })
    expect(id).toBe('job-1')
    expect(mockJobUpdate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          sourceItemId: 'note-1',
          sourceName: 'notes.md',
          truncated: true,
          collectionName: 'notes',
        }),
      }),
    )
  })
})

describe('getSourceText', () => {
  it('slices a note\'s content to the parse window in memory and flags truncation', async () => {
    const item: ParseSourceItem = {
      id: 'note-1',
      itemTypeName: 'note',
      content: 'a'.repeat(SPLIT_FILE_MAX_INPUT_CHARS + 200),
      fileUrl: null,
      fileName: null,
    }
    const result = await getSourceText(item)
    expect(result.truncated).toBe(true)
    expect(result.text.length).toBeLessThanOrEqual(SPLIT_FILE_MAX_INPUT_CHARS)
    expect(mockGetTextFromS3).not.toHaveBeenCalled() // notes never hit S3
  })

  it('returns a short note whole (not truncated)', async () => {
    const item: ParseSourceItem = { id: 'n', itemTypeName: 'note', content: 'short note', fileUrl: null, fileName: null }
    expect(await getSourceText(item)).toMatchObject({ text: 'short note', truncated: false })
  })

  it('truncates a long note at the last paragraph break (\\n\\n) in the back half — no mid-word cut', async () => {
    const head = 'a'.repeat(30_000)
    const tail = 'b'.repeat(25_000) // pushes total past the 50k window
    const item: ParseSourceItem = { id: 'p', itemTypeName: 'note', content: `${head}\n\n${tail}`, fileUrl: null, fileName: null }
    const result = await getSourceText(item)
    expect(result.truncated).toBe(true)
    expect(result.text).toBe(head) // cut back to the paragraph break, not the raw window
  })

  it('truncates at the last line break (\\n) when no paragraph break falls in the back half', async () => {
    const head = 'a'.repeat(30_000)
    const tail = 'b'.repeat(25_000)
    const item: ParseSourceItem = { id: 'l', itemTypeName: 'note', content: `${head}\n${tail}`, fileUrl: null, fileName: null }
    const result = await getSourceText(item)
    expect(result.truncated).toBe(true)
    expect(result.text).toBe(head)
  })

  it('hard-cuts at the window when the only break is in the front half', async () => {
    // Break at 10k (< the 25k midpoint) → no clean boundary past the midpoint → hard cut at the window.
    const content = `${'a'.repeat(10_000)}\n${'b'.repeat(45_000)}`
    const item: ParseSourceItem = { id: 'h', itemTypeName: 'note', content, fileUrl: null, fileName: null }
    const result = await getSourceText(item)
    expect(result.truncated).toBe(true)
    expect(result.text.length).toBe(SPLIT_FILE_MAX_INPUT_CHARS)
  })

  it('reads a text file via a bounded S3 range read', async () => {
    mockGetTextFromS3.mockResolvedValue({ text: 'file body', truncated: true })
    const item: ParseSourceItem = { id: 'f', itemTypeName: 'file', content: null, fileUrl: 'user/a.txt', fileName: 'a.txt' }
    const result = await getSourceText(item)
    expect(mockGetTextFromS3).toHaveBeenCalledWith('user/a.txt', SPLIT_FILE_MAX_INPUT_CHARS)
    expect(result).toMatchObject({ text: 'file body', truncated: true, sourceName: 'a.txt' })
  })

  it('throws for a non-text file extension (eligibility re-validated server-side)', async () => {
    const item: ParseSourceItem = { id: 'f', itemTypeName: 'file', content: null, fileUrl: 'user/a.bin', fileName: 'a.bin' }
    await expect(getSourceText(item)).rejects.toThrow()
    expect(mockGetTextFromS3).not.toHaveBeenCalled()
  })

  it('throws for an ineligible item type', async () => {
    const item: ParseSourceItem = { id: 'i', itemTypeName: 'image', content: null, fileUrl: 'k', fileName: 'a.png' }
    await expect(getSourceText(item)).rejects.toThrow()
  })
})

describe('deleteJob', () => {
  it('deletes the job (IDOR-scoped) and returns the response id to cancel when processing', async () => {
    mockJob.findFirst.mockResolvedValue({ openaiResponseId: 'resp_1', status: 'processing' })
    mockJob.deleteMany.mockResolvedValue({ count: 1 })

    const result = await deleteJob('user-1', 'job-1')
    expect(result).toEqual({ openaiResponseId: 'resp_1' })
    expect(mockJob.deleteMany).toHaveBeenCalledWith({ where: { id: 'job-1', userId: 'user-1' } })
  })

  it('returns a null response id when the job is not processing (nothing to cancel)', async () => {
    mockJob.findFirst.mockResolvedValue({ openaiResponseId: 'resp_1', status: 'completed' })
    mockJob.deleteMany.mockResolvedValue({ count: 1 })
    expect(await deleteJob('user-1', 'job-1')).toEqual({ openaiResponseId: null })
  })

  it('returns null and deletes nothing when the job is not the user\'s (IDOR)', async () => {
    mockJob.findFirst.mockResolvedValue(null)
    expect(await deleteJob('user-1', 'job-x')).toBeNull()
    expect(mockJob.deleteMany).not.toHaveBeenCalled()
  })
})

describe('listParseSourceCandidates', () => {
  it('filters to the user\'s text file items (.txt/.md) and maps to the picker shape', async () => {
    mockItem.findMany.mockResolvedValue([{ id: 'f1', fileName: 'notes.md', fileSize: 123 }])
    const result = await listParseSourceCandidates('user-1')

    expect(result).toEqual([{ itemId: 'f1', name: 'notes.md', sizeBytes: 123 }])
    expect(mockItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-1',
          itemType: { name: 'file' },
          OR: [
            { fileName: { endsWith: '.txt', mode: 'insensitive' } },
            { fileName: { endsWith: '.md', mode: 'insensitive' } },
          ],
        }),
      }),
    )
  })
})
