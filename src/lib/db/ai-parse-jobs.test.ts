import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockReset } from 'vitest-mock-extended'
import { Prisma } from '@/generated/prisma/client'
import { objectContaining, arrayContaining, anything } from '@/test/matchers'

vi.mock('@/lib/infra/prisma', async () => (await import('@/test/prisma-mock')).createPrismaMockModule())
vi.mock('@/lib/db/items', () => ({ createItem: vi.fn() }))
vi.mock('@/lib/storage/s3', () => ({ getTextFromS3: vi.fn() }))
// Default: no Redis → the sweep cooldown fails open (sweep proceeds), matching production without Redis.
// Individual tests override `getRedis` to exercise the cooldown-held path.
vi.mock('@/lib/infra/redis', () => ({ getRedis: vi.fn(() => null) }))
vi.mock('@/lib/infra/pino', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}))

import { prisma } from '@/lib/infra/prisma'
import { getRedis } from '@/lib/infra/redis'
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
  getParseJobSourceItemId,
  deleteJob,
  getSourceText,
  listParseSourceCandidates,
  listActiveParseJobs,
  listClosedParseJobs,
  getReparseEligibility,
  parseJobAbandonCutoff,
  sweepAbandonedParseJobs,
  type ParseSourceItem,
} from '@/lib/db/ai-parse-jobs'
import { SPLIT_FILE_MAX_INPUT_CHARS, PARSE_JOB_TTL_MS } from '@/lib/utils/constants'
import { brainDumpProgress, type BrainDumpDraft } from '@/lib/ai/brain-dump'
import { asPrismaMock } from '@/test/prisma-mock'

const prismaMock = asPrismaMock(prisma)

const mockJob = prismaMock.aiParseJob
const mockJobItem = prismaMock.aiParseJobItem
// Deliberate second alias for the same aiParseJob model: mockJob reads assertions on
// findFirst/deleteMany; mockJobUpdate names the update/create-claim assertions apart.
const mockJobUpdate = prismaMock.aiParseJob
const mockItem = prismaMock.item
const mockCollection = prismaMock.collection
const mockCreateItem = createItem as ReturnType<typeof vi.fn>
const mockGetTextFromS3 = getTextFromS3 as ReturnType<typeof vi.fn>

beforeEach(() => {
  mockReset(prismaMock)
  // clearAllMocks also resets the non-prisma vi.fn() mocks (createItem/getTextFromS3)
  // that mockReset(prismaMock) does not touch.
  vi.clearAllMocks()
  prismaMock.$transaction.mockImplementation((callback: (tx: typeof prismaMock) => Promise<unknown>) => {
    return callback(prismaMock)
  })
})

describe('commitJob', () => {
  // commitDrafts is atomic delete-guards-create: the draft delete (tx.aiParseJobItem.deleteMany) runs
  // FIRST and must report count:1 for createItem to fire. Default that here; tests override per case.
  beforeEach(() => {
    mockJobItem.deleteMany.mockResolvedValue({ count: 1 })
    // closeJob's guarded read of the running stats (status != 'closed').
    mockJob.findFirst.mockResolvedValue(null)
  })

  it('maps each draft to createItem with the right per-type fields, then closes the job (history stub)', async () => {
    mockJob.findFirst
      .mockResolvedValueOnce({
        status: 'completed',
        collectionName: null,
        collectionIds: [],
        items: [
          { id: 'd1', order: 0, itemTypeName: 'snippet', title: 'S', content: 'code', url: null, language: 'ts', description: 'desc', tags: ['a'] },
          { id: 'd2', order: 1, itemTypeName: 'link', title: 'L', content: null, url: 'https://x.dev', language: null, description: null, tags: [] },
        ],
      })
      .mockResolvedValueOnce({ collectionName: null, collectionIds: [] }) // resolveJobCollectionIds read
      .mockResolvedValueOnce({ committedCount: 0, committedByType: null }) // closeJob's stats read
    mockCreateItem.mockResolvedValue({ id: 'real' })

    const result = await commitJob('user-1', 'job-1')

    // v2.5: full commit demotes the job to the `closed` history stub (not a delete) — `closed: true`.
    expect(result).toEqual({ kind: 'done', created: 2, total: 2, closed: true })
    expect(mockJob.findFirst).toHaveBeenCalledWith(objectContaining({ where: { id: 'job-1', userId: 'user-1' } }))
    expect(mockCreateItem).toHaveBeenCalledWith('user-1', objectContaining({
      itemTypeName: 'snippet', content: 'code', language: 'ts', url: null, fileUrl: null, collectionIds: [],
    }), anything())
    expect(mockCreateItem).toHaveBeenCalledWith('user-1', objectContaining({
      itemTypeName: 'link', url: 'https://x.dev', content: null,
    }), anything())
    // Closed, not deleted: status set to 'closed' + sourceText cleared + per-type stats stamped.
    expect(mockJobUpdate.updateMany).toHaveBeenCalledWith(
      objectContaining({
        where: { id: 'job-1', userId: 'user-1', status: { not: 'closed' } },
        data: objectContaining({ status: 'closed', sourceText: '', committedCount: { increment: 2 }, committedByType: { snippet: 1, link: 1 } }),
      }),
    )
    expect(mockJob.deleteMany).not.toHaveBeenCalled()
  })

  it('excludes trashed drafts from the commit (only non-trashed are read)', async () => {
    // Empty non-trashed items: commitJob short-circuits to closeJob without resolving collections (no
    // pending collection should be materialized for a job that commits nothing), so the only reads are
    // the job-read and closeJob's stats-read — no resolveJobCollectionIds findFirst.
    mockJob.findFirst
      .mockResolvedValueOnce({ status: 'completed', collectionName: null, collectionIds: [], items: [] })
      .mockResolvedValueOnce({ committedCount: 0, committedByType: null }) // closeJob

    await commitJob('user-1', 'job-1')

    expect(mockJob.findFirst).toHaveBeenCalledWith(
      objectContaining({
        select: objectContaining({
          items: objectContaining({ where: { trashed: false } }),
        }),
      }),
    )
    // The empty-items path must NOT create a collection.
    expect(mockCollection.create).not.toHaveBeenCalled()
  })

  it('creates a new collection from the job name and attaches every item to it + existing ids', async () => {
    mockJob.findFirst
      .mockResolvedValueOnce({
        status: 'completed',
        collectionName: 'Project X',
        collectionIds: ['col-existing'],
        items: [
          { id: 'd1', order: 0, itemTypeName: 'note', title: 'A', content: 'a', url: null, language: null, description: null, tags: [] },
        ],
      })
      // resolveJobCollectionIds initial read, then closeJob stats read.
      .mockResolvedValueOnce({ collectionName: 'Project X', collectionIds: ['col-existing'] })
      .mockResolvedValueOnce({ committedCount: 0, committedByType: null })
    mockJobUpdate.updateMany.mockResolvedValue({ count: 1 }) // wins the new-collection claim
    mockCollection.create.mockResolvedValue({ id: 'col-new' })
    mockCreateItem.mockResolvedValue({ id: 'real' })

    await commitJob('user-1', 'job-1')

    expect(prisma.$transaction).toHaveBeenCalled()
    expect(mockCollection.create).toHaveBeenCalledWith({
      data: { userId: 'user-1', name: 'Project X' },
      select: { id: true },
    })
    expect(mockCreateItem).toHaveBeenCalledWith(
      'user-1',
      objectContaining({ collectionIds: ['col-existing', 'col-new'] }),
      anything(),
    )
  })

  it('creates no collection when the job has no name (only existing ids are attached)', async () => {
    mockJob.findFirst
      .mockResolvedValueOnce({
        status: 'completed',
        collectionName: null,
        collectionIds: ['col-a'],
        items: [
          { id: 'd1', order: 0, itemTypeName: 'note', title: 'A', content: 'a', url: null, language: null, description: null, tags: [] },
        ],
      })
      .mockResolvedValueOnce({ collectionName: null, collectionIds: ['col-a'] })
      .mockResolvedValueOnce({ committedCount: 0, committedByType: null })
    mockCreateItem.mockResolvedValue({ id: 'real' })

    await commitJob('user-1', 'job-1')

    expect(mockCollection.create).not.toHaveBeenCalled()
    expect(mockCreateItem).toHaveBeenCalledWith('user-1', objectContaining({ collectionIds: ['col-a'] }), anything())
  })

  it('counts only successful creates and does NOT close on partial failure', async () => {
    mockJob.findFirst
      .mockResolvedValueOnce({
        status: 'completed',
        collectionName: null,
        collectionIds: [],
        items: [
          { id: 'd1', order: 0, itemTypeName: 'snippet', title: 'A', content: 'a', url: null, language: 'ts', description: null, tags: [] },
          { id: 'd2', order: 1, itemTypeName: 'note', title: 'B', content: 'b', url: null, language: null, description: null, tags: [] },
        ],
      })
      .mockResolvedValueOnce({ collectionName: null, collectionIds: [] }) // resolveJobCollectionIds read
      .mockResolvedValueOnce({ committedCount: 0, committedByType: null }) // partial recordInReviewCommit stats read
    // d1 commits (its tx delete returns 1), d2 fails (createItem null → tx rolls back, draft kept).
    mockCreateItem.mockResolvedValueOnce({ id: 'real' }).mockResolvedValueOnce(null)

    const result = await commitJob('user-1', 'job-1')

    expect(result).toEqual({ kind: 'done', created: 1, total: 2, closed: false })
    // Not closed on a partial commit (the un-saved draft must survive for retry).
    expect(mockJobUpdate.updateMany).not.toHaveBeenCalledWith(
      objectContaining({ data: objectContaining({ status: 'closed' }) }),
    )
    // The draft that DID commit must still land on the in-review running tally (status != 'closed'),
    // so the final history stats don't undercount when the survivor is later committed.
    expect(mockJobUpdate.updateMany).toHaveBeenCalledWith(
      objectContaining({
        where: { id: 'job-1', userId: 'user-1', status: { not: 'closed' } },
        data: objectContaining({ committedCount: { increment: 1 }, committedByType: { snippet: 1 } }),
      }),
    )
  })

  it('skips a link draft with no url — not created, not deleted, job stays open', async () => {
    mockJob.findFirst
      .mockResolvedValueOnce({
        status: 'completed',
        collectionName: null,
        collectionIds: [],
        items: [
          { id: 'd1', order: 0, itemTypeName: 'link', title: 'L', content: null, url: null, language: null, description: null, tags: [] },
          { id: 'd2', order: 1, itemTypeName: 'note', title: 'B', content: 'b', url: null, language: null, description: null, tags: [] },
        ],
      })
      .mockResolvedValueOnce({ collectionName: null, collectionIds: [] }) // resolveJobCollectionIds read
      .mockResolvedValueOnce({ committedCount: 0, committedByType: null }) // recordInReviewCommit stats read
    mockCreateItem.mockResolvedValue({ id: 'real' })

    const result = await commitJob('user-1', 'job-1')

    // The urlless link is kept committable; only the note commits → not all drafts saved, no close.
    expect(result).toEqual({ kind: 'done', created: 1, total: 2, closed: false })
    expect(mockCreateItem).toHaveBeenCalledTimes(1)
    expect(mockCreateItem).toHaveBeenCalledWith('user-1', objectContaining({ itemTypeName: 'note' }), anything())
    expect(mockCreateItem).not.toHaveBeenCalledWith('user-1', objectContaining({ itemTypeName: 'link' }), anything())
    // The link draft is never deleted (it survives for the user to add a url or reclassify).
    expect(mockJobItem.deleteMany).not.toHaveBeenCalledWith({ where: { id: 'd1', jobId: 'job-1', userId: 'user-1' } })
    expect(mockJobUpdate.updateMany).not.toHaveBeenCalledWith(
      objectContaining({ data: objectContaining({ status: 'closed' }) }),
    )
  })

  it('a closed job is a no-op done (no committable drafts)', async () => {
    mockJob.findFirst.mockResolvedValueOnce({ status: 'closed', collectionName: null, collectionIds: [], items: [] })

    expect(await commitJob('user-1', 'job-1')).toEqual({ kind: 'done', created: 0, total: 0, closed: true })
    expect(mockCreateItem).not.toHaveBeenCalled()
  })

  it('returns not_found and creates nothing when the job is not the user\'s (IDOR)', async () => {
    mockJob.findFirst.mockResolvedValueOnce(null)

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

  beforeEach(() => {
    // commitDrafts' atomic delete-guards-create needs the draft delete to report a removed row.
    mockJobItem.deleteMany.mockResolvedValue({ count: 1 })
  })

  it('returns null (404) when the draft is not the user\'s or is trashed (IDOR)', async () => {
    mockJob.findFirst.mockResolvedValueOnce({ status: 'completed' }) // job status lookup
    mockJobItem.findFirst.mockResolvedValue(null)

    expect(await commitDraftItem('user-1', 'job-1', 'item-x')).toBeNull()
    // In-review job → require trashed:false (a trashed draft must not commit from the board).
    expect(mockJobItem.findFirst).toHaveBeenCalledWith(
      objectContaining({ where: { id: 'item-x', jobId: 'job-1', userId: 'user-1', trashed: false } }),
    )
    expect(mockCreateItem).not.toHaveBeenCalled()
  })

  it('attaches the job\'s existing collections, creates the item, deletes the draft, auto-closes when last', async () => {
    mockJob.findFirst
      .mockResolvedValueOnce({ status: 'completed' }) // job status
      .mockResolvedValueOnce({ collectionName: null }) // hasPendingNewCollection
      .mockResolvedValueOnce({ collectionName: null, collectionIds: ['col-a'] }) // resolveJobCollectionIds
      .mockResolvedValueOnce({ committedCount: 0, committedByType: null }) // recordInReviewCommit stats read
      .mockResolvedValueOnce({ committedCount: 1, committedByType: { note: 1 } }) // closeJob stats read
    mockJobItem.findFirst.mockResolvedValue(draft)
    mockCreateItem.mockResolvedValue({ id: 'real' })
    mockJobItem.count.mockResolvedValue(0) // no non-trashed drafts remain → auto-close

    expect(await commitDraftItem('user-1', 'job-1', 'd1')).toEqual({ created: 1, autoClosed: true, needsCollectionConfirm: false })
    expect(mockCollection.create).not.toHaveBeenCalled()
    expect(mockCreateItem).toHaveBeenCalledWith('user-1', objectContaining({ itemTypeName: 'note', collectionIds: ['col-a'] }), anything())
    expect(mockJobItem.deleteMany).toHaveBeenCalledWith({ where: { id: 'd1', jobId: 'job-1', userId: 'user-1' } })
    // The per-item commit records its type on the running tally as it lands (so an incremental commit run
    // carries an accurate total, not just the final draft)…
    expect(mockJobUpdate.updateMany).toHaveBeenCalledWith(
      objectContaining({ data: objectContaining({ committedCount: { increment: 1 }, committedByType: { note: 1 } }) }),
    )
    // …then the close demotes the job, passing no new types (already counted above). With nothing to merge,
    // the close write touches only status + sourceText — it does NOT rewrite the per-type map or do an
    // increment:0, which would only widen the write set against a concurrent late increment.
    expect(mockJobUpdate.updateMany).toHaveBeenCalledWith(
      objectContaining({ data: objectContaining({ status: 'closed', sourceText: '' }) }),
    )
    expect(mockJobUpdate.updateMany).not.toHaveBeenCalledWith(
      objectContaining({ data: objectContaining({ status: 'closed', committedByType: anything() }) }),
    )
  })

  it('does NOT auto-close when other non-trashed drafts remain, but still records the commit on the tally', async () => {
    mockJob.findFirst
      .mockResolvedValueOnce({ status: 'completed' })
      .mockResolvedValueOnce({ collectionName: null })
      .mockResolvedValueOnce({ collectionName: null, collectionIds: [] })
      .mockResolvedValueOnce({ committedCount: 0, committedByType: null }) // recordInReviewCommit stats read
    mockJobItem.findFirst.mockResolvedValue(draft)
    mockCreateItem.mockResolvedValue({ id: 'real' })
    mockJobItem.count.mockResolvedValue(2) // siblings remain

    expect(await commitDraftItem('user-1', 'job-1', 'd1')).toEqual({ created: 1, autoClosed: false, needsCollectionConfirm: false })
    expect(mockJobUpdate.updateMany).not.toHaveBeenCalledWith(
      objectContaining({ data: objectContaining({ status: 'closed' }) }),
    )
    // The running tally is bumped even though the job stays in review (this is what fixes the undercount
    // when the user saves drafts one at a time before the final auto-close).
    expect(mockJobUpdate.updateMany).toHaveBeenCalledWith(
      objectContaining({ data: objectContaining({ committedCount: { increment: 1 }, committedByType: { note: 1 } }) }),
    )
  })

  it('holds the commit and asks for confirmation when a new collection is pending and unconfirmed', async () => {
    mockJob.findFirst
      .mockResolvedValueOnce({ status: 'completed' })
      .mockResolvedValueOnce({ collectionName: 'Project X' }) // hasPendingNewCollection → true
    mockJobItem.findFirst.mockResolvedValue(draft)

    expect(await commitDraftItem('user-1', 'job-1', 'd1')).toEqual({ created: 0, autoClosed: false, needsCollectionConfirm: true })
    // Held: nothing created/deleted, no collection materialized.
    expect(mockCreateItem).not.toHaveBeenCalled()
    expect(mockCollection.create).not.toHaveBeenCalled()
  })

  it('confirm=false commits WITHOUT creating the pending collection (cancel path)', async () => {
    mockJob.findFirst
      .mockResolvedValueOnce({ status: 'completed' })
      .mockResolvedValueOnce({ collectionName: 'Project X', collectionIds: ['col-a'] }) // resolveJobCollectionIds (skipNew)
      .mockResolvedValueOnce({ committedCount: 0, committedByType: null }) // recordInReviewCommit stats read
      .mockResolvedValueOnce({ committedCount: 1, committedByType: { note: 1 } }) // closeJob stats read
    mockJobItem.findFirst.mockResolvedValue(draft)
    mockCreateItem.mockResolvedValue({ id: 'real' })
    mockJobItem.count.mockResolvedValue(0)

    const res = await commitDraftItem('user-1', 'job-1', 'd1', { confirmCreateCollection: false })

    expect(res).toEqual({ created: 1, autoClosed: true, needsCollectionConfirm: false })
    // The new collection is NOT created; only existing ids attach.
    expect(mockCollection.create).not.toHaveBeenCalled()
    expect(mockCreateItem).toHaveBeenCalledWith('user-1', objectContaining({ collectionIds: ['col-a'] }), anything())
  })

  it('confirm=true creates the new collection once and persists its id (no duplicate)', async () => {
    mockJob.findFirst
      .mockResolvedValueOnce({ status: 'completed' })
      .mockResolvedValueOnce({ collectionName: 'Project X', collectionIds: ['col-a'] }) // resolveJobCollectionIds
      .mockResolvedValueOnce({ committedCount: 0, committedByType: null }) // recordInReviewCommit stats read
      .mockResolvedValueOnce({ committedCount: 1, committedByType: { note: 1 } }) // closeJob stats read
    mockJobItem.findFirst.mockResolvedValue(draft)
    mockJobUpdate.updateMany.mockResolvedValue({ count: 1 }) // wins the guarded claim
    mockCollection.create.mockResolvedValue({ id: 'col-new' })
    mockCreateItem.mockResolvedValue({ id: 'real' })
    mockJobItem.count.mockResolvedValue(0)

    expect(await commitDraftItem('user-1', 'job-1', 'd1', { confirmCreateCollection: true })).toEqual({
      created: 1, autoClosed: true, needsCollectionConfirm: false,
    })
    expect(prisma.$transaction).toHaveBeenCalled()
    expect(mockJobUpdate.updateMany).toHaveBeenCalledWith({
      where: { id: 'job-1', userId: 'user-1', collectionName: 'Project X' },
      data: { collectionName: null },
    })
    expect(mockCollection.create).toHaveBeenCalledWith({ data: { userId: 'user-1', name: 'Project X' }, select: { id: true } })
    expect(mockCreateItem).toHaveBeenCalledWith('user-1', objectContaining({ collectionIds: ['col-a', 'col-new'] }), anything())
  })

  it('keeps the draft when createItem fails (0)', async () => {
    mockJob.findFirst
      .mockResolvedValueOnce({ status: 'completed' })
      .mockResolvedValueOnce({ collectionName: null })
      .mockResolvedValueOnce({ collectionName: null, collectionIds: [] })
    mockJobItem.findFirst.mockResolvedValue(draft)
    mockCreateItem.mockResolvedValue(null) // create fails → tx rolls back, draft kept

    expect(await commitDraftItem('user-1', 'job-1', 'd1')).toEqual({ created: 0, autoClosed: false, needsCollectionConfirm: false })
  })

  it('creates nothing when the guarding delete removes 0 rows (lost the double-commit race)', async () => {
    mockJob.findFirst
      .mockResolvedValueOnce({ status: 'completed' })
      .mockResolvedValueOnce({ collectionName: null })
      .mockResolvedValueOnce({ collectionName: null, collectionIds: [] })
    mockJobItem.findFirst.mockResolvedValue(draft)
    // Another tab/commit already took this draft: the delete-guards-create delete removes 0 rows.
    mockJobItem.deleteMany.mockResolvedValue({ count: 0 })
    mockCreateItem.mockResolvedValue({ id: 'real' })

    expect(await commitDraftItem('user-1', 'job-1', 'd1')).toEqual({ created: 0, autoClosed: false, needsCollectionConfirm: false })
    // The guard must short-circuit BEFORE createItem — a 0-row delete creates nothing (kills the
    // double-commit race), even though createItem is mocked to succeed.
    expect(mockCreateItem).not.toHaveBeenCalled()
    // The delete + create must run inside ONE interactive transaction — a refactor that split them
    // back into separate awaits (re-opening the race) would drop this call and fail here.
    expect(prisma.$transaction).toHaveBeenCalled()
  })

  it('on a closed job commits a trashed draft and merges stub stats (no trashed filter)', async () => {
    mockJob.findFirst
      .mockResolvedValueOnce({ status: 'closed' }) // job status
      .mockResolvedValueOnce({ collectionName: null }) // hasPendingNewCollection
      .mockResolvedValueOnce({ collectionName: null, collectionIds: [] }) // resolveJobCollectionIds
      .mockResolvedValueOnce({ committedCount: 5, committedByType: { note: 5 } }) // mergeClosedJobStats read
    mockJobItem.findFirst.mockResolvedValue({ ...draft, trashed: true })
    mockCreateItem.mockResolvedValue({ id: 'real' })

    const res = await commitDraftItem('user-1', 'job-1', 'd1')

    expect(res).toEqual({ created: 1, autoClosed: false, needsCollectionConfirm: false })
    // Closed job → no trashed:false constraint on the draft lookup (trash is committable).
    expect(mockJobItem.findFirst).toHaveBeenCalledWith(
      objectContaining({ where: { id: 'd1', jobId: 'job-1', userId: 'user-1' } }),
    )
    // Stats merged additively onto the existing closed stub, status stays closed.
    expect(mockJobUpdate.updateMany).toHaveBeenCalledWith(
      objectContaining({
        where: { id: 'job-1', userId: 'user-1', status: 'closed' },
        data: { committedCount: { increment: 1 }, committedByType: { note: 6 } },
      }),
    )
  })

  it('treats a corrupt (non-object) committedByType as empty when merging a late commit', async () => {
    mockJob.findFirst
      .mockResolvedValueOnce({ status: 'closed' }) // job status
      .mockResolvedValueOnce({ collectionName: null }) // hasPendingNewCollection
      .mockResolvedValueOnce({ collectionName: null, collectionIds: [] }) // resolveJobCollectionIds
      .mockResolvedValueOnce({ committedCount: 2, committedByType: ['corrupt'] }) // mergeClosedJobStats read
    mockJobItem.findFirst.mockResolvedValue({ ...draft, trashed: true })
    mockCreateItem.mockResolvedValue({ id: 'real' })

    await commitDraftItem('user-1', 'job-1', 'd1')

    // The stray array is discarded (asCommittedByType → {}) rather than corrupting the tally, so the map is
    // rebuilt from just this commit. The scalar count still increments atomically.
    expect(mockJobUpdate.updateMany).toHaveBeenCalledWith(
      objectContaining({
        where: { id: 'job-1', userId: 'user-1', status: 'closed' },
        data: { committedCount: { increment: 1 }, committedByType: { note: 1 } },
      }),
    )
  })

  it('uses Serializable isolation and retries the stats bump on a P2034 write conflict', async () => {
    mockJob.findFirst
      .mockResolvedValueOnce({ status: 'closed' }) // job status
      .mockResolvedValueOnce({ collectionName: null }) // hasPendingNewCollection
      .mockResolvedValueOnce({ collectionName: null, collectionIds: [] }) // resolveJobCollectionIds
      .mockResolvedValue({ committedCount: 5, committedByType: { note: 5 } }) // each stats-tx read (incl. retry)
    mockJobItem.findFirst.mockResolvedValue({ ...draft, trashed: true })
    mockCreateItem.mockResolvedValue({ id: 'real' })

    // The first stats transaction loses a serialization race (Postgres returns P2034); the bump must
    // retry rather than surfacing the conflict or losing the increment. Non-stats transactions (which
    // pass no isolation option) flow through untouched.
    const real = prisma.$transaction as unknown as ReturnType<typeof vi.fn>
    const passthrough = (cb: (tx: unknown) => unknown) => cb(prisma)
    let conflicted = false
    real.mockImplementation((cb: (tx: unknown) => unknown, opts?: { isolationLevel?: string }) => {
      if (opts?.isolationLevel === 'Serializable' && !conflicted) {
        conflicted = true
        throw new Prisma.PrismaClientKnownRequestError('write conflict', { code: 'P2034', clientVersion: 'test' })
      }
      return passthrough(cb)
    })

    const res = await commitDraftItem('user-1', 'job-1', 'd1')

    expect(res).toEqual({ created: 1, autoClosed: false, needsCollectionConfirm: false })
    expect(conflicted).toBe(true) // the conflict path was actually hit
    // After the retry the merge still lands exactly once with the atomic increment (no lost update).
    expect(mockJobUpdate.updateMany).toHaveBeenCalledWith(
      objectContaining({
        where: { id: 'job-1', userId: 'user-1', status: 'closed' },
        data: { committedCount: { increment: 1 }, committedByType: { note: 6 } },
      }),
    )
  })

  it('rethrows after exhausting the P2034 retry budget when the conflict never clears', async () => {
    mockJob.findFirst
      .mockResolvedValueOnce({ status: 'closed' }) // job status
      .mockResolvedValueOnce({ collectionName: null }) // hasPendingNewCollection
      .mockResolvedValueOnce({ collectionName: null, collectionIds: [] }) // resolveJobCollectionIds
      .mockResolvedValue({ committedCount: 5, committedByType: { note: 5 } })
    mockJobItem.findFirst.mockResolvedValue({ ...draft, trashed: true })
    mockCreateItem.mockResolvedValue({ id: 'real' })

    // Every stats transaction loses the serialization race: the bump must retry a bounded number of times
    // and then surface the conflict rather than spinning forever.
    const real = prisma.$transaction as unknown as ReturnType<typeof vi.fn>
    const passthrough = (cb: (tx: unknown) => unknown) => cb(prisma)
    let serializableAttempts = 0
    real.mockImplementation((cb: (tx: unknown) => unknown, opts?: { isolationLevel?: string }) => {
      if (opts?.isolationLevel === 'Serializable') {
        serializableAttempts += 1
        throw new Prisma.PrismaClientKnownRequestError('write conflict', { code: 'P2034', clientVersion: 'test' })
      }
      return passthrough(cb)
    })

    await expect(commitDraftItem('user-1', 'job-1', 'd1')).rejects.toThrow('write conflict')
    expect(serializableAttempts).toBe(5) // MAX_RETRIES attempts, then it gives up
  })

  it('rethrows a non-P2034 transaction error immediately without retrying', async () => {
    mockJob.findFirst
      .mockResolvedValueOnce({ status: 'closed' }) // job status
      .mockResolvedValueOnce({ collectionName: null }) // hasPendingNewCollection
      .mockResolvedValueOnce({ collectionName: null, collectionIds: [] }) // resolveJobCollectionIds
      .mockResolvedValue({ committedCount: 5, committedByType: { note: 5 } })
    mockJobItem.findFirst.mockResolvedValue({ ...draft, trashed: true })
    mockCreateItem.mockResolvedValue({ id: 'real' })

    const real = prisma.$transaction as unknown as ReturnType<typeof vi.fn>
    const passthrough = (cb: (tx: unknown) => unknown) => cb(prisma)
    let serializableAttempts = 0
    real.mockImplementation((cb: (tx: unknown) => unknown, opts?: { isolationLevel?: string }) => {
      if (opts?.isolationLevel === 'Serializable') {
        serializableAttempts += 1
        throw new Error('db exploded')
      }
      return passthrough(cb)
    })

    await expect(commitDraftItem('user-1', 'job-1', 'd1')).rejects.toThrow('db exploded')
    expect(serializableAttempts).toBe(1) // a non-conflict error is not a retryable condition
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
    expect(mockJobItem.create).toHaveBeenNthCalledWith(1, objectContaining({ data: objectContaining({ jobId: 'job-1', userId: 'user-1', order: 5 }) }))
    // Progress + cursor advance together with the draft writes.
    expect(mockJobUpdate.updateMany).toHaveBeenCalledWith({
      where: { id: 'job-1', userId: 'user-1' },
      data: { progress: brainDumpProgress(7), streamCursor: 42 },
    })
  })

  it('advances the cursor only (single updateMany, no transaction) for an empty boundary batch', async () => {
    const saved = await appendDraftsAndAdvance('user-1', 'job-1', [], 5, 99)

    expect(saved).toEqual([])
    // One statement, so no transaction is opened for the empty-batch cursor advance.
    expect(prisma.$transaction).not.toHaveBeenCalled()
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
    expect(mockJob.findFirst).toHaveBeenCalledWith(objectContaining({ where: { id: 'job-x', userId: 'user-1' } }))
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
    mockCollection.findMany.mockResolvedValue([])
    expect(await updateJobCollections('user-1', 'job-1', { collectionIds: ['foreign'] })).toBe('invalid_collections')
    expect(mockJobUpdate.updateMany).not.toHaveBeenCalled()
  })

  it('returns not_found when the job is not the user\'s, even with an owned collection (IDOR)', async () => {
    // Owned collection passes validation, so this exercises the job-level IDOR guard specifically:
    // updateMany scopes `where: { id: jobId, userId }`, and a foreign job matches 0 rows.
    mockCollection.findMany.mockResolvedValue([{ id: 'c1' } as unknown as never])
    mockJobUpdate.updateMany.mockResolvedValue({ count: 0 })

    expect(await updateJobCollections('user-1', 'job-x', { collectionIds: ['c1'] })).toBe('not_found')
    expect(mockJobUpdate.updateMany).toHaveBeenCalledWith(
      objectContaining({ where: { id: 'job-x', userId: 'user-1' } }),
    )
  })
})

describe('listActiveParseJobs', () => {
  it('includes processing + completed/failed jobs with committable drafts (and self-heals close-pending)', async () => {
    const mockFindMany = prisma.aiParseJob.findMany as ReturnType<typeof vi.fn>
    // First findMany = the self-heal pass (close-pending jobs with zero non-trashed drafts) → none here.
    mockFindMany.mockResolvedValueOnce([])
    // Second findMany = the actual active list.
    mockFindMany.mockResolvedValueOnce([
      { id: 'j1', status: 'processing', progress: 40, sourceName: 'a.md', createdAt: new Date('2026-01-01'), _count: { items: 2 } },
      { id: 'j2', status: 'completed', progress: 100, sourceName: 'b.txt', createdAt: new Date('2026-01-02'), _count: { items: 3 } },
      { id: 'j3', status: 'failed', progress: 100, sourceName: 'c.txt', createdAt: new Date('2026-01-03'), _count: { items: 1 } },
    ])

    const jobs = await listActiveParseJobs('user-1')

    expect(jobs).toHaveLength(3)
    // The active query includes failed jobs (so a failed job stays reachable) and excludes closed.
    expect(mockFindMany).toHaveBeenCalledWith(
      objectContaining({
        where: objectContaining({
          userId: 'user-1',
          OR: arrayContaining([
            { status: 'processing' },
            { status: 'failed' },
            { status: 'completed', items: { some: { trashed: false } } },
          ]),
        }),
      }),
    )
  })

  it('self-heals an in-review job left with zero non-trashed drafts (closes it before listing)', async () => {
    const mockFindMany = prisma.aiParseJob.findMany as ReturnType<typeof vi.fn>
    // Self-heal pass finds one close-pending job…
    mockFindMany.mockResolvedValueOnce([{ id: 'pending-1' }])
    // …closeJob reads its stats…
    mockJob.findFirst.mockResolvedValueOnce({ committedCount: 3, committedByType: { note: 3 } })
    // …then the active list returns empty (it's now closed).
    mockFindMany.mockResolvedValueOnce([])

    await listActiveParseJobs('user-1')

    expect(mockJob.findFirst).toHaveBeenCalledWith(
      objectContaining({ where: objectContaining({ id: 'pending-1', status: { not: 'closed' } }) }),
    )
    expect(mockJobUpdate.updateMany).toHaveBeenCalledWith(
      objectContaining({ data: objectContaining({ status: 'closed' }) }),
    )
  })

  it('keeps a zero-draft failed job reachable and never self-heals it', async () => {
    const mockFindMany = prisma.aiParseJob.findMany as ReturnType<typeof vi.fn>
    // Self-heal pass is scoped to completed-only → finds nothing (the failed job is excluded).
    mockFindMany.mockResolvedValueOnce([])
    // Active list still surfaces the failed job even though it has zero non-trashed drafts.
    mockFindMany.mockResolvedValueOnce([
      { id: 'failed-1', status: 'failed', progress: 0, sourceName: 'x.md', createdAt: new Date('2026-02-01'), _count: { items: 0 } },
    ])

    const jobs = await listActiveParseJobs('user-1')

    expect(mockJobUpdate.updateMany).not.toHaveBeenCalled()
    expect(jobs).toEqual([objectContaining({ id: 'failed-1', status: 'failed' })])
    // The self-heal pass query is completed-only (failed jobs are never closed by it).
    expect(mockFindMany).toHaveBeenNthCalledWith(
      1,
      objectContaining({ where: objectContaining({ status: 'completed' }) }),
    )
  })
})

describe('listClosedParseJobs', () => {
  it('lists only closed jobs with stub stats + trashed-draft count, newest first (IDOR-scoped)', async () => {
    const mockFindMany = prisma.aiParseJob.findMany as ReturnType<typeof vi.fn>
    mockFindMany.mockResolvedValue([
      {
        id: 'c1', status: 'closed', progress: 100, sourceName: 'done.md', createdAt: new Date('2026-02-01'),
        committedCount: 5, committedByType: { snippet: 3, note: 2 }, _count: { items: 1 },
      },
    ])

    const jobs = await listClosedParseJobs('user-1')

    expect(jobs).toEqual([
      objectContaining({ id: 'c1', status: 'closed', itemCount: 1, committedCount: 5, committedByType: { snippet: 3, note: 2 } }),
    ])
    expect(mockFindMany).toHaveBeenCalledWith(
      objectContaining({
        where: { userId: 'user-1', status: 'closed' },
        orderBy: { createdAt: 'desc' },
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
    expect(mockJob.findFirst).toHaveBeenCalledWith(objectContaining({ where: { id: 'job-x', userId: 'user-1' } }))
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
      items: [{ id: 'd1', order: 0, itemTypeName: 'note', title: 'A', content: 'a', url: null, language: null, description: null, tags: [], trashed: false }],
    })
    // No committed items → no duplicate matches (advisory de-dup batched in the snapshot).
    mockItem.findMany.mockResolvedValue([])
    const snap = await getParseJobSnapshot('user-1', 'job-1')
    expect(snap).toMatchObject({
      status: 'completed',
      sourceItemId: 'note-1',
      sourceItemType: 'note',
      sourceName: 'notes.md',
      truncated: true,
      items: [{ id: 'd1', duplicateOf: null }],
    })
  })

  it('attaches duplicateOf for a draft that matches a committed item', async () => {
    mockJob.findFirst.mockResolvedValue({
      status: 'completed',
      progress: 100,
      error: null,
      collectionName: null,
      collectionIds: [],
      sourceItemId: 'note-1',
      sourceName: 'notes.md',
      truncated: false,
      sourceItem: { itemType: { name: 'note' } },
      items: [{ id: 'd1', order: 0, itemTypeName: 'note', title: 'Deploy script', content: 'a', url: null, language: null, description: null, tags: [], trashed: false }],
    })
    mockItem.findMany.mockResolvedValue([
      { id: 'existing-1', title: 'deploy script', content: null, itemType: { name: 'command' } },
    ])
    const snap = await getParseJobSnapshot('user-1', 'job-1')
    expect(snap?.items[0].duplicateOf).toEqual({ id: 'existing-1', title: 'deploy script', itemTypeName: 'command' })
  })

  it('computes de-dup on a failed job (partials stay committable, so the badge must still show)', async () => {
    mockJob.findFirst.mockResolvedValue({
      status: 'failed', progress: 100, error: 'model_error: stream ended early',
      collectionName: null, collectionIds: [], sourceItemId: 'note-1', sourceName: 'notes.md', truncated: false,
      sourceItem: { itemType: { name: 'note' } },
      items: [{ id: 'd1', order: 0, itemTypeName: 'note', title: 'Deploy script', content: 'a', url: null, language: null, description: null, tags: [], trashed: false }],
    })
    mockItem.findMany.mockResolvedValue([
      { id: 'existing-1', title: 'deploy script', content: null, itemType: { name: 'command' } },
    ])
    const snap = await getParseJobSnapshot('user-1', 'job-1')
    // A failed job is committable, so the committed-item lookup runs and the badge attaches.
    expect(mockItem.findMany).toHaveBeenCalled()
    expect(snap?.items[0].duplicateOf).toEqual({ id: 'existing-1', title: 'deploy script', itemTypeName: 'command' })
  })

  it('skips de-dup on a processing job (no committed-item lookup on the hot stream-seed path)', async () => {
    mockJob.findFirst.mockResolvedValue({
      status: 'processing', progress: 40, error: null,
      collectionName: null, collectionIds: [], sourceItemId: 'note-1', sourceName: 'notes.md', truncated: false,
      sourceItem: { itemType: { name: 'note' } },
      items: [{ id: 'd1', order: 0, itemTypeName: 'note', title: 'Deploy script', content: 'a', url: null, language: null, description: null, tags: [], trashed: false }],
    })
    const snap = await getParseJobSnapshot('user-1', 'job-1')
    expect(mockItem.findMany).not.toHaveBeenCalled()
    expect(snap?.items[0].duplicateOf).toBeNull()
  })

  it('returns the closed-job stub stats and skips de-dup on a closed job', async () => {
    mockJob.findFirst.mockResolvedValue({
      status: 'closed', progress: 100, error: null,
      committedCount: 5, committedByType: { snippet: 3, note: 2 },
      collectionName: null, collectionIds: [], sourceItemId: 'note-1', sourceName: 'n.md', truncated: false,
      sourceItem: { itemType: { name: 'note' } },
      items: [{ id: 'd1', order: 0, itemTypeName: 'note', title: 'T', content: 'a', url: null, language: null, description: null, tags: [], trashed: true }],
    })

    const snap = await getParseJobSnapshot('user-1', 'job-1')

    expect(snap?.status).toBe('closed')
    expect(snap?.committedCount).toBe(5)
    expect(snap?.committedByType).toEqual({ snippet: 3, note: 2 })
    // De-dup is skipped for a closed job (only trashed drafts remain) — no item lookup.
    expect(mockItem.findMany).not.toHaveBeenCalled()
    expect(snap?.items[0].duplicateOf).toBeNull()
  })

  it('self-heals a close-pending job: a completed job with zero non-trashed drafts re-reads as closed', async () => {
    // First read: completed but only trashed drafts remain (close-pending shape after a crash).
    mockJob.findFirst.mockResolvedValueOnce({
      status: 'completed', progress: 100, error: null, committedCount: 4, committedByType: { note: 4 },
      collectionName: null, collectionIds: [], sourceItemId: 'n', sourceName: 'n', truncated: false,
      sourceItem: { itemType: { name: 'note' } },
      items: [{ id: 'd1', order: 0, itemTypeName: 'note', title: 'T', content: 'a', url: null, language: null, description: null, tags: [], trashed: true }],
    })
    // closeJob's guarded stats read inside the heal.
    mockJob.findFirst.mockResolvedValueOnce({ committedCount: 4, committedByType: { note: 4 } })
    // No third read: after the heal writes status=closed, the snapshot is built from the in-memory job
    // mutated to the closed shape (committedCount/committedByType are what the heal preserves), not re-fetched.

    const snap = await getParseJobSnapshot('user-1', 'job-1')

    // The heal wrote status=closed.
    expect(mockJobUpdate.updateMany).toHaveBeenCalledWith(
      objectContaining({ data: objectContaining({ status: 'closed' }) }),
    )
    expect(snap?.status).toBe('closed')
  })

  it('does NOT self-heal a failed job with zero non-trashed drafts (its remediation must stay reachable)', async () => {
    // A failed job that never persisted a committable draft is terminal review state, not close-pending —
    // closing it would clear sourceText/drop it from the active list and destroy the remediation detail.
    mockJob.findFirst.mockResolvedValue({
      status: 'failed', progress: 0, error: 'content_filter: blocked', committedCount: 0, committedByType: null,
      collectionName: null, collectionIds: [], sourceItemId: 'n', sourceName: 'n', truncated: false,
      sourceItem: { itemType: { name: 'note' } },
      items: [],
    })
    mockItem.findMany.mockResolvedValue([])

    const snap = await getParseJobSnapshot('user-1', 'job-1')

    expect(mockJobUpdate.updateMany).not.toHaveBeenCalled()
    expect(snap?.status).toBe('failed')
  })
})

describe('getReparseEligibility', () => {
  it('returns status + sourceItemId for an owned job (IDOR-scoped)', async () => {
    mockJob.findFirst.mockResolvedValue({ status: 'completed', sourceItemId: 'note-1' })
    expect(await getReparseEligibility('user-1', 'job-1')).toEqual({ status: 'completed', sourceItemId: 'note-1' })
    expect(mockJob.findFirst).toHaveBeenCalledWith(
      objectContaining({ where: { id: 'job-1', userId: 'user-1' } }),
    )
  })

  it('returns null for a foreign/missing job', async () => {
    mockJob.findFirst.mockResolvedValue(null)
    expect(await getReparseEligibility('user-1', 'job-x')).toBeNull()
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
      objectContaining({
        data: objectContaining({
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

describe('getParseJobSourceItemId', () => {
  it('returns the durable source id from an IDOR-scoped job read', async () => {
    mockJob.findFirst.mockResolvedValue({ sourceItemId: 'note-1' })
    expect(await getParseJobSourceItemId('user-1', 'job-1')).toBe('note-1')
    expect(mockJob.findFirst).toHaveBeenCalledWith({
      where: { id: 'job-1', userId: 'user-1' },
      select: { sourceItemId: true },
    })
  })

  it('returns null for a foreign job or deleted source', async () => {
    mockJob.findFirst.mockResolvedValue(null)
    expect(await getParseJobSourceItemId('user-1', 'foreign')).toBeNull()
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

  it.each(['snippet', 'command', 'prompt', 'note'])('accepts %s items with stored content', async (itemTypeName) => {
    const item: ParseSourceItem = { id: itemTypeName, itemTypeName, content: 'source text', fileUrl: null, fileName: null }
    expect(await getSourceText(item)).toMatchObject({ text: 'source text', truncated: false })
    expect(mockGetTextFromS3).not.toHaveBeenCalled()
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
    await expect(getSourceText(item)).rejects.toThrow('not a text file')
    expect(mockGetTextFromS3).not.toHaveBeenCalled()
  })

  it('throws for an ineligible item type', async () => {
    const item: ParseSourceItem = { id: 'i', itemTypeName: 'image', content: null, fileUrl: 'k', fileName: 'a.png' }
    await expect(getSourceText(item)).rejects.toThrow('ineligible source item type')
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
  it('filters to the user\'s brain-dump-tagged text file items (.txt/.md) and maps to the picker shape', async () => {
    mockItem.findMany.mockResolvedValue([{ id: 'f1', fileName: 'notes.md', fileSize: 123 }])
    const result = await listParseSourceCandidates('user-1')

    expect(result).toEqual([{ itemId: 'f1', name: 'notes.md', itemTypeName: 'file', sizeBytes: 123 }])
    expect(mockItem.findMany).toHaveBeenCalledWith(
      objectContaining({
        where: objectContaining({
          userId: 'user-1',
          itemType: { name: 'file' },
          tags: { some: { name: 'brain-dump' } },
          OR: [
            { fileName: { endsWith: '.txt', mode: 'insensitive' } },
            { fileName: { endsWith: '.md', mode: 'insensitive' } },
          ],
        }),
      }),
    )
  })

  it('lists brain-dump-tagged content items (by title, type, content byte length) when kind=content, IDOR-scoped', async () => {
    mockItem.findMany.mockResolvedValue([
      { id: 'n1', title: 'Project ideas', content: 'héllo', itemType: { name: 'prompt' } },
    ])
    const result = await listParseSourceCandidates('user-1', 'content')

    // 'héllo' is 6 UTF-8 bytes (é = 2 bytes) — sizeBytes is the content byte length, not char count.
    expect(result).toEqual([{ itemId: 'n1', name: 'Project ideas', itemTypeName: 'prompt', sizeBytes: 6 }])
    expect(mockItem.findMany).toHaveBeenCalledWith(
      objectContaining({
        where: objectContaining({
          userId: 'user-1',
          itemType: { name: { in: ['snippet', 'command', 'prompt', 'note'] } },
          tags: { some: { name: 'brain-dump' } },
        }),
      }),
    )
  })

  it('falls back to a placeholder name and null size for an empty untitled content item', async () => {
    mockItem.findMany.mockResolvedValue([{ id: 'n2', title: '', content: null, itemType: { name: 'note' } }])
    const result = await listParseSourceCandidates('user-1', 'content')

    expect(result).toEqual([{ itemId: 'n2', name: 'Untitled source', itemTypeName: 'note', sizeBytes: null }])
  })
})

describe('parseJobAbandonCutoff', () => {
  it('returns now minus the default 24h TTL', () => {
    const now = 1_000_000_000_000
    expect(parseJobAbandonCutoff(now).getTime()).toBe(now - PARSE_JOB_TTL_MS)
  })

  it('honors an explicit ttlMs', () => {
    const now = 5_000
    expect(parseJobAbandonCutoff(now, 1_000).getTime()).toBe(4_000)
  })
})

describe('sweepAbandonedParseJobs', () => {
  beforeEach(() => vi.clearAllMocks())

  // The fail-open (no-Redis) path is throttled by an in-process timestamp guard, so these tests use
  // `now` values spaced well beyond the 300s cooldown to keep each sweep claimable in isolation.
  it('deletes stale non-closed jobs, keeping the source item, with a TOCTOU-guarded deleteMany', async () => {
    const now = 1_700_000_000_000
    mockJob.findMany.mockResolvedValue([{ id: 'job-a' }, { id: 'job-b' }])
    mockJob.deleteMany.mockResolvedValue({ count: 2 })

    const result = await sweepAbandonedParseJobs(now)

    // Selects stale jobs before the cutoff AND excludes closed (history is never auto-purged).
    const stalePredicate = { updatedAt: { lt: parseJobAbandonCutoff(now) }, status: { not: 'closed' } }
    expect(mockJob.findMany).toHaveBeenCalledWith(objectContaining({ where: stalePredicate }))
    // TOCTOU guard: deleteMany re-asserts the staleness predicate (not just id IN […]), so a job revived
    // in the findMany→deleteMany window is skipped. Source item untouched (no item.delete).
    expect(mockJob.deleteMany).toHaveBeenCalledWith({
      where: { AND: [{ id: { in: ['job-a', 'job-b'] } }, stalePredicate] },
    })
    expect(result).toEqual({ swept: 2 })
  })

  it('TOCTOU: counts only the rows the guarded deleteMany actually removed (revived job skipped)', async () => {
    // Use a winning Redis mock so this run claims the window WITHOUT touching the in-process timestamp
    // guard (which would leak across the no-Redis throttle test).
    const set = vi.fn().mockResolvedValue('OK')
    vi.mocked(getRedis).mockReturnValueOnce({ set } as unknown as ReturnType<typeof getRedis>)
    mockJob.findMany.mockResolvedValue([{ id: 'job-a' }, { id: 'job-b' }])
    // One of the two was revived/closed in the window → deleteMany removed only 1.
    mockJob.deleteMany.mockResolvedValue({ count: 1 })

    expect(await sweepAbandonedParseJobs(1_700_000_005_000)).toEqual({ swept: 1 })
  })

  it('no-ops when nothing is stale', async () => {
    mockJob.findMany.mockResolvedValue([])
    const result = await sweepAbandonedParseJobs(1_700_000_001_000)
    expect(mockJob.deleteMany).not.toHaveBeenCalled()
    expect(result).toEqual({ swept: 0 })
  })

  it('swallows errors and reports zero swept (best-effort)', async () => {
    mockJob.findMany.mockRejectedValue(new Error('db down'))
    const result = await sweepAbandonedParseJobs(1_700_000_002_000)
    expect(result).toEqual({ swept: 0 })
  })

  it('throttles the no-Redis path with an in-process guard within the cooldown window', async () => {
    // Two sweeps inside the 300s window on the fail-open path: the second is throttled in-process and
    // never touches the DB, even though Redis is unavailable.
    const base = 1_800_000_000_000
    mockJob.findMany.mockResolvedValue([{ id: 'job-x' }])
    mockJob.deleteMany.mockResolvedValue({ count: 1 })

    const first = await sweepAbandonedParseJobs(base)
    const second = await sweepAbandonedParseJobs(base + 1000)

    expect(first).toEqual({ swept: 1 })
    expect(second).toEqual({ swept: 0 })
    expect(mockJob.findMany).toHaveBeenCalledTimes(1)
  })

  it('proceeds and claims the cooldown when it wins the Redis window', async () => {
    // `SET NX` returns 'OK' when the key was free → this run won the window and must sweep, setting the
    // cooldown key with the NX+EX guard. A regression on the `=== 'OK'` comparison would fail here.
    const set = vi.fn().mockResolvedValue('OK')
    vi.mocked(getRedis).mockReturnValueOnce({ set } as unknown as ReturnType<typeof getRedis>)
    mockJob.findMany.mockResolvedValue([{ id: 'job-c' }])
    mockJob.deleteMany.mockResolvedValue({ count: 1 })

    const result = await sweepAbandonedParseJobs(1_700_000_003_000)

    expect(set).toHaveBeenCalledWith('parse-job-sweep:cooldown', '1', { nx: true, ex: 300 })
    expect(mockJob.deleteMany).toHaveBeenCalledWith(
      objectContaining({ where: { AND: arrayContaining([{ id: { in: ['job-c'] } }]) } }),
    )
    expect(result).toEqual({ swept: 1 })
  })

  it('skips the sweep when the Redis cooldown window is already held', async () => {
    // `SET NX` returns null when the key exists → a recent sweep holds the window; this run must no-op.
    const set = vi.fn().mockResolvedValue(null)
    vi.mocked(getRedis).mockReturnValueOnce({ set } as unknown as ReturnType<typeof getRedis>)

    const result = await sweepAbandonedParseJobs(1_700_000_000_000)

    expect(set).toHaveBeenCalledWith('parse-job-sweep:cooldown', '1', { nx: true, ex: 300 })
    expect(mockJob.findMany).not.toHaveBeenCalled()
    expect(mockJob.deleteMany).not.toHaveBeenCalled()
    expect(result).toEqual({ swept: 0 })
  })
})
