import { describe, it, expect } from 'vitest'
import { runBulk } from './run-bulk'

describe('runBulk', () => {
  it('returns an empty result for no ids', async () => {
    let calls = 0
    const result = await runBulk([], () => {
      calls += 1
      return Promise.resolve(true)
    })
    expect(result).toEqual({ succeeded: [], failed: [] })
    expect(calls).toBe(0)
  })

  it('marks every id succeeded when the task resolves true', async () => {
    const result = await runBulk(['a', 'b', 'c'], () => Promise.resolve(true))
    expect(result.succeeded).toEqual(['a', 'b', 'c'])
    expect(result.failed).toEqual([])
  })

  it('marks every id failed when the task resolves false', async () => {
    const result = await runBulk(['a', 'b'], () => Promise.resolve(false))
    expect(result.succeeded).toEqual([])
    expect(result.failed).toEqual(['a', 'b'])
  })

  it('partitions mixed success/failure per id', async () => {
    const fail = new Set(['b', 'd'])
    const result = await runBulk(['a', 'b', 'c', 'd'], (id) => Promise.resolve(!fail.has(id)))
    expect(result.succeeded).toEqual(['a', 'c'])
    expect(result.failed).toEqual(['b', 'd'])
  })

  it('treats a throwing task as a failed id without rejecting the call', async () => {
    const result = await runBulk(['a', 'b', 'c'], (id) => {
      if (id === 'b') return Promise.reject(new Error('boom'))
      return Promise.resolve(true)
    })
    expect(result.succeeded).toEqual(['a', 'c'])
    expect(result.failed).toEqual(['b'])
  })

  it('runs ids in capped-concurrency waves and preserves order across waves', async () => {
    // 20 ids exceed the wave size (8), exercising multiple waves; every-other id fails.
    const ids = Array.from({ length: 20 }, (_, i) => `id-${i}`)
    let maxInFlight = 0
    let inFlight = 0
    const result = await runBulk(ids, async (id) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await Promise.resolve()
      inFlight -= 1
      return Number(id.slice(3)) % 2 === 0
    })
    expect(maxInFlight).toBeLessThanOrEqual(8)
    expect(result.succeeded).toEqual(ids.filter((_, i) => i % 2 === 0))
    expect(result.failed).toEqual(ids.filter((_, i) => i % 2 === 1))
  })
})
