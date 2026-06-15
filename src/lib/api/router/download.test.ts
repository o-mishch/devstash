import { vi, describe, it, expect, beforeEach } from 'vitest'
import { invoke, expectORPCError } from '@/test/orpc'

vi.mock('@/lib/session', () => ({ getCachedSession: vi.fn() }))
vi.mock('@/lib/billing/access/pro-access-resolution', () => ({ getCachedVerifiedProAccess: vi.fn() }))
vi.mock('@/lib/db/items', () => ({ getDownloadItem: vi.fn() }))
vi.mock('@/lib/storage/s3', () => ({ getSignedDownloadUrl: vi.fn(), getSignedUrlExpiresAt: vi.fn() }))
vi.mock('@/lib/storage/image-thumbnails', () => ({
  canGenerateImageThumbnail: vi.fn(() => true),
  getImageThumbnailKey: vi.fn(() => 'user-1/thumb.webp'),
}))

import { getCachedSession } from '@/lib/session'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'
import { getDownloadItem } from '@/lib/db/items'
import { getSignedDownloadUrl, getSignedUrlExpiresAt } from '@/lib/storage/s3'
import { downloadRouter } from './download'

const mockSession = getCachedSession as ReturnType<typeof vi.fn>
const mockIsPro = getCachedVerifiedProAccess as ReturnType<typeof vi.fn>
const mockGetDownloadItem = getDownloadItem as ReturnType<typeof vi.fn>
const mockGetSignedDownloadUrl = getSignedDownloadUrl as ReturnType<typeof vi.fn>
const mockGetExpiresAt = getSignedUrlExpiresAt as ReturnType<typeof vi.fn>

const fileItem = { id: 'item-1', itemType: { name: 'file' }, fileUrl: 'user-1/doc.pdf', fileName: 'doc.pdf' }
const imageItem = { id: 'item-2', itemType: { name: 'image' }, fileUrl: 'user-1/pic.png', fileName: 'pic.png' }

beforeEach(() => {
  vi.clearAllMocks()
  mockSession.mockResolvedValue({ user: { id: 'user-1' } })
  mockIsPro.mockResolvedValue(true)
  mockGetDownloadItem.mockResolvedValue(fileItem)
  mockGetSignedDownloadUrl.mockResolvedValue('https://s3.example/signed')
  mockGetExpiresAt.mockReturnValue(new Date('2026-01-01T00:00:00.000Z'))
})

describe('download.getSignedUrl', () => {
  it('throws UNAUTHORIZED when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    await expectORPCError(invoke(downloadRouter.getSignedUrl, { id: 'item-1' }), 'UNAUTHORIZED')
  })

  it('throws NOT_FOUND when the item does not exist', async () => {
    mockGetDownloadItem.mockResolvedValue(null)
    await expectORPCError(invoke(downloadRouter.getSignedUrl, { id: 'missing' }), 'NOT_FOUND')
  })

  it('throws BAD_REQUEST for a non-file/image item type', async () => {
    mockGetDownloadItem.mockResolvedValue({ ...fileItem, itemType: { name: 'snippet' } })
    await expectORPCError(invoke(downloadRouter.getSignedUrl, { id: 'item-1' }), 'BAD_REQUEST')
  })

  it('throws NOT_FOUND for a legacy external (http) fileUrl', async () => {
    mockGetDownloadItem.mockResolvedValue({ ...fileItem, fileUrl: 'https://legacy.example/file.pdf' })
    await expectORPCError(invoke(downloadRouter.getSignedUrl, { id: 'item-1' }), 'NOT_FOUND')
  })

  it('throws FORBIDDEN for a non-Pro user on a full download', async () => {
    mockIsPro.mockResolvedValue(false)
    await expectORPCError(invoke(downloadRouter.getSignedUrl, { id: 'item-1' }), 'FORBIDDEN')
  })

  it('returns a signed URL for a Pro user', async () => {
    const result = await invoke(downloadRouter.getSignedUrl, { id: 'item-1' })
    expect(result).toEqual({ url: 'https://s3.example/signed', expiresAt: '2026-01-01T00:00:00.000Z' })
    expect(mockGetSignedDownloadUrl).toHaveBeenCalledWith('user-1/doc.pdf', undefined, 'doc.pdf')
  })

  it('returns a thumbnail preview URL for a non-Pro user on an image preview', async () => {
    mockIsPro.mockResolvedValue(false)
    mockGetDownloadItem.mockResolvedValue(imageItem)
    const result = await invoke(downloadRouter.getSignedUrl, { id: 'item-2', preview: true })
    expect(result.url).toBe('https://s3.example/signed')
    expect(mockGetSignedDownloadUrl).toHaveBeenCalledWith('user-1/thumb.webp', undefined, undefined)
  })

  it('treats a query-string preview=false as a full download, not the thumbnail', async () => {
    mockGetDownloadItem.mockResolvedValue(imageItem)
    // OpenAPILink serializes `preview: false` to the query string 'false'; native z.coerce.boolean()
    // would wrongly coerce that to `true` and sign the thumbnail instead of the original file.
    await invoke(downloadRouter.getSignedUrl, { id: 'item-2', preview: 'false' })
    expect(mockGetSignedDownloadUrl).toHaveBeenCalledWith('user-1/pic.png', undefined, 'pic.png')
  })
})
