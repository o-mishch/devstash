import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetRedis, mockGet, mockSet, mockDel } = vi.hoisted(() => ({
  mockGetRedis: vi.fn(),
  mockGet: vi.fn(),
  mockSet: vi.fn(),
  mockDel: vi.fn(),
}))

vi.mock('@/lib/infra/redis', () => ({
  getRedis: mockGetRedis,
}))

import {
  invalidateProAccessCache,
  readProAccessCache,
  writeProAccessCache,
} from './pro-access-cache'

beforeEach(() => {
  vi.clearAllMocks()
  mockGetRedis.mockReturnValue({
    get: mockGet,
    set: mockSet,
    del: mockDel,
  })
})

describe('pro-access-cache', () => {
  it('reads and writes through Redis when available', async () => {
    mockGet.mockResolvedValue(true)

    await expect(readProAccessCache('user-1')).resolves.toBe(true)
    expect(mockGet).toHaveBeenCalledWith('stripe:pro-access:user-1')

    await writeProAccessCache('user-1', false)
    expect(mockSet).toHaveBeenCalledWith('stripe:pro-access:user-1', false, { ex: 60 })
  })

  it('invalidates Redis and memory cache entries', async () => {
    mockGetRedis.mockReturnValue(null)
    await writeProAccessCache('user-1', true)
    await invalidateProAccessCache('user-1')

    await expect(readProAccessCache('user-1')).resolves.toBeNull()
  })
})
