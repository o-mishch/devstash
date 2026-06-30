import { describe, it, expect } from 'vitest'
import { resolveDbPoolMax } from './db-local'

// resolveDbPoolMax bounds each pod's node-postgres pool so `maxReplicas * pool` stays
// under the managed Postgres max_connections (Cloud SQL dev = 100). The GKE overlay
// sets DB_POOL_MAX=5 (10 replicas * 5 = 50, with headroom for the migrate Job).
describe('resolveDbPoolMax', () => {
  it('defaults to 5 when unset', () => {
    expect(resolveDbPoolMax(undefined)).toBe(5)
  })

  it('honors a valid positive override', () => {
    expect(resolveDbPoolMax('8')).toBe(8)
    expect(resolveDbPoolMax('1')).toBe(1)
  })

  it('falls back to the default for non-positive or non-numeric values', () => {
    expect(resolveDbPoolMax('0')).toBe(5)
    expect(resolveDbPoolMax('-3')).toBe(5)
    expect(resolveDbPoolMax('abc')).toBe(5)
    expect(resolveDbPoolMax('')).toBe(5)
  })
})
