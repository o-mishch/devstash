import { vi, describe, it, expect, beforeEach } from 'vitest'
import { readJson } from '@/test/matchers'
import { NextRequest } from 'next/server'
import type { getCachedSession as GetCachedSessionFn } from '@/lib/session'
import type { getCachedVerifiedProAccess as GetCachedVerifiedProAccessFn } from '@/lib/billing/access/pro-access-resolution'
import type { getDownloadItem as GetDownloadItemFn } from '@/lib/db/items'
import type { getSignedDownloadUrl as GetSignedDownloadUrlFn, getSignedUrlExpiresAt } from '@/lib/storage/s3'
import type { canGenerateImageThumbnail as CanGenerateImageThumbnailFn, getImageThumbnailKey } from '@/lib/storage/image-thumbnails'

vi.mock('@/lib/session', () => ({ getCachedSession: vi.fn<typeof GetCachedSessionFn>() }))
vi.mock('@/lib/billing/access/pro-access-resolution', () => ({
  getCachedVerifiedProAccess: vi.fn<typeof GetCachedVerifiedProAccessFn>(),
}))
vi.mock('@/lib/db/items', () => ({ getDownloadItem: vi.fn<typeof GetDownloadItemFn>() }))
vi.mock('@/lib/storage/s3', () => ({
  getSignedDownloadUrl: vi.fn<typeof GetSignedDownloadUrlFn>(),
  getSignedUrlExpiresAt: vi.fn<typeof getSignedUrlExpiresAt>(() => new Date('2026-01-01T00:00:00.000Z')),
}))
vi.mock('@/lib/storage/image-thumbnails', () => ({
  canGenerateImageThumbnail: vi.fn<typeof CanGenerateImageThumbnailFn>(),
  getImageThumbnailKey: vi.fn<typeof getImageThumbnailKey>((key: string) => `thumb/${key}`),
}))

import { getCachedSession } from '@/lib/session'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'
import { getDownloadItem } from '@/lib/db/items'
import { getSignedDownloadUrl } from '@/lib/storage/s3'
import { canGenerateImageThumbnail } from '@/lib/storage/image-thumbnails'
import { GET } from './route'

const mockSession = vi.mocked(getCachedSession)
const mockPro = vi.mocked(getCachedVerifiedProAccess)
const mockGetDownloadItem = vi.mocked(getDownloadItem)
const mockSignedUrl = vi.mocked(getSignedDownloadUrl)
const mockCanThumbnail = vi.mocked(canGenerateImageThumbnail)

function get(id: string, preview?: boolean) {
  const qs = preview === undefined ? '' : `?preview=${preview}`
  const req = new NextRequest(`http://localhost/api/download/${id}/url${qs}`)
  return GET(req, { params: Promise.resolve({ id }) })
}

const fileItem = {
  id: 'item-1',
  itemType: { name: 'file' },
  fileUrl: 'user-1/file.pdf',
  fileName: 'doc.pdf',
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}
const imageItem = {
  id: 'item-2',
  itemType: { name: 'image' },
  fileUrl: 'user-1/pic.png',
  fileName: 'pic.png',
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSession.mockResolvedValue({ user: { id: 'user-1', isPro: true }, expires: '2026-12-31T00:00:00.000Z' })
  mockPro.mockResolvedValue(true)
  mockSignedUrl.mockResolvedValue('https://s3/signed')
  mockCanThumbnail.mockReturnValue(true)
})

describe('GET /download/{id}/url', () => {
  it('returns 401 when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    const res = await get('item-1')
    expect(res.status).toBe(401)
  })

  it('returns 404 when the item is not found', async () => {
    mockGetDownloadItem.mockResolvedValue(null)
    const res = await get('item-1')
    expect(res.status).toBe(404)
  })

  it('returns 400 for a non-file/image item', async () => {
    mockGetDownloadItem.mockResolvedValue({
      id: 'x',
      itemType: { name: 'snippet' },
      fileUrl: 'user-1/x',
      fileName: null,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    const res = await get('item-1')
    expect(res.status).toBe(400)
  })

  it('returns 404 for a legacy external (http) fileUrl', async () => {
    mockGetDownloadItem.mockResolvedValue({ ...fileItem, fileUrl: 'https://legacy/file.pdf' })
    const res = await get('item-1')
    expect(res.status).toBe(404)
  })

  it('returns 403 when a non-Pro user requests a full download', async () => {
    mockPro.mockResolvedValue(false)
    mockGetDownloadItem.mockResolvedValue(fileItem)
    const res = await get('item-1')
    expect(res.status).toBe(403)
  })

  it('returns 200 with a signed URL for a Pro full download', async () => {
    mockGetDownloadItem.mockResolvedValue(fileItem)
    const res = await get('item-1')
    expect(res.status).toBe(200)
    expect((await readJson(res)).url).toBe('https://s3/signed')
    expect(mockSignedUrl).toHaveBeenCalledWith('user-1/file.pdf', undefined, 'doc.pdf')
  })

  it('serves an image preview to a non-Pro user via the thumbnail key', async () => {
    mockPro.mockResolvedValue(false)
    mockGetDownloadItem.mockResolvedValue(imageItem)
    const res = await get('item-2', true)
    expect(res.status).toBe(200)
    expect(mockSignedUrl).toHaveBeenCalledWith('thumb/user-1/pic.png', undefined, undefined)
  })

  it('returns 403 for a non-Pro preview when no thumbnail can be generated', async () => {
    mockPro.mockResolvedValue(false)
    mockCanThumbnail.mockReturnValue(false)
    mockGetDownloadItem.mockResolvedValue(imageItem)
    const res = await get('item-2', true)
    expect(res.status).toBe(403)
  })
})
