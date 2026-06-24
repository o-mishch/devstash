import { describe, expect, it } from 'vitest'
import { queryKeys, queryKeyMatches } from './query-keys'

describe('queryKeys', () => {
  describe('collections', () => {
    it('returns the correct query key for collections list', () => {
      const key = queryKeys.collections.list()
      expect(key).toEqual(['get', '/collections'])
    })

    it('returns the correct query key for collection detail by ID', () => {
      const id = 'col_123'
      const key = queryKeys.collections.detail(id)
      expect(key).toEqual(['get', '/collections/{id}', { params: { path: { id } } }])
    })
  })

  describe('billingContext', () => {
    it('returns the correct query key for billing context', () => {
      const key = queryKeys.billingContext()
      expect(key).toEqual(['get', '/billing/context'])
    })
  })

  describe('profile', () => {
    it('returns the correct query key for the full profile read', () => {
      expect(queryKeys.profile()).toEqual(['get', '/profile'])
    })

    it('returns the correct query key for the lightweight user-profile flags', () => {
      expect(queryKeys.userProfile()).toEqual(['get', '/profile/me'])
    })
  })

  describe('editorPreferences', () => {
    it('returns the correct query key for editor preferences', () => {
      expect(queryKeys.editorPreferences()).toEqual(['get', '/profile/editor-preferences'])
    })
  })
})

describe('queryKeyMatches', () => {
  describe('collections', () => {
    it('matches exact collections list path', () => {
      expect(queryKeyMatches.collections(['get', '/collections'])).toBe(true)
    })

    it('matches the list key produced by the factory (no producer/matcher drift)', () => {
      expect(queryKeyMatches.collections(queryKeys.collections.list())).toBe(true)
    })

    it('matches collection detail path', () => {
      expect(queryKeyMatches.collections(queryKeys.collections.detail('col_123'))).toBe(true)
    })

    it('matches collections path with query params or additional sub-routes', () => {
      expect(queryKeyMatches.collections(['get', '/collections', { query: { limit: 10 } }])).toBe(true)
      expect(queryKeyMatches.collections(['get', '/collections/{id}/items'])).toBe(true)
    })

    it('does not match non-collections paths', () => {
      expect(queryKeyMatches.collections(['get', '/items'])).toBe(false)
      expect(queryKeyMatches.collections(['get', '/ai/brain-dump'])).toBe(false)
      expect(queryKeyMatches.collections(['post', '/collections'])).toBe(false)
    })

    it('does not match a too-short key with no path segment', () => {
      expect(queryKeyMatches.collections(['get'])).toBe(false)
    })

    it('does not false-positive on a sibling path that shares the /collections prefix', () => {
      expect(queryKeyMatches.collections(['get', '/collections-export'])).toBe(false)
    })
  })

  describe('brainDumpJobs', () => {
    it('matches both job-list variants — active ({}) and history', () => {
      expect(queryKeyMatches.brainDumpJobs(['get', '/ai/brain-dump'])).toBe(true)
      expect(queryKeyMatches.brainDumpJobs(['get', '/ai/brain-dump', { query: { history: '1' } }])).toBe(true)
    })

    it('does not match the sources path or other paths', () => {
      expect(queryKeyMatches.brainDumpJobs(['get', '/ai/brain-dump/sources'])).toBe(false)
      expect(queryKeyMatches.brainDumpJobs(['post', '/ai/brain-dump'])).toBe(false)
      expect(queryKeyMatches.brainDumpJobs(['get'])).toBe(false)
    })
  })

  describe('brainDumpSources', () => {
    it('matches both source-picker tabs — file and content', () => {
      expect(queryKeyMatches.brainDumpSources(['get', '/ai/brain-dump/sources'])).toBe(true)
      expect(queryKeyMatches.brainDumpSources(['get', '/ai/brain-dump/sources', { query: { type: 'content' } }])).toBe(true)
    })

    it('does not match the job-list path or other paths', () => {
      expect(queryKeyMatches.brainDumpSources(['get', '/ai/brain-dump'])).toBe(false)
      expect(queryKeyMatches.brainDumpSources(['post', '/ai/brain-dump/sources'])).toBe(false)
    })
  })
})
