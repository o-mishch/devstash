import { describe, expect, it } from 'vitest'
import { PRO_GATE_COPY, isProGateFeature, proGateFeatureForPath } from './pro-gate'

describe('proGateFeatureForPath', () => {
  it('gates the Brain Dump hub and its job sub-paths', () => {
    expect(proGateFeatureForPath('/parse')).toBe('brain-dump')
    expect(proGateFeatureForPath('/parse/job-123')).toBe('brain-dump')
  })

  it('gates the file and image item pages', () => {
    expect(proGateFeatureForPath('/items/files')).toBe('files')
    expect(proGateFeatureForPath('/items/images')).toBe('images')
  })

  it('does not gate non-Pro item pages or unrelated routes', () => {
    expect(proGateFeatureForPath('/items/notes')).toBeNull()
    expect(proGateFeatureForPath('/items/snippets')).toBeNull()
    expect(proGateFeatureForPath('/dashboard')).toBeNull()
    expect(proGateFeatureForPath('/upgrade')).toBeNull()
  })

  it('does not gate paths that merely contain a gated segment', () => {
    expect(proGateFeatureForPath('/items/files/extra')).toBeNull()
    expect(proGateFeatureForPath('/parsexyz')).toBeNull()
  })
})

describe('isProGateFeature', () => {
  it('accepts every known gate feature and its matching copy', () => {
    Object.keys(PRO_GATE_COPY).forEach((feature) => {
      expect(isProGateFeature(feature)).toBe(true)
    })
  })

  it('rejects unknown, null, and undefined tokens', () => {
    expect(isProGateFeature('bogus')).toBe(false)
    expect(isProGateFeature(null)).toBe(false)
    expect(isProGateFeature(undefined)).toBe(false)
  })
})

describe('PRO_GATE_COPY', () => {
  it('has copy for every feature proGateFeatureForPath can emit', () => {
    ;['/parse', '/items/files', '/items/images'].forEach((path) => {
      const feature = proGateFeatureForPath(path)
      expect(feature).not.toBeNull()
      expect(PRO_GATE_COPY[feature as keyof typeof PRO_GATE_COPY]).toBeTruthy()
    })
  })
})
