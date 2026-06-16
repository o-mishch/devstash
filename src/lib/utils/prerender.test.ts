import { describe, it, expect } from 'vitest'
import { isPrerenderInterrupt } from '@/lib/utils/prerender'

describe('isPrerenderInterrupt', () => {
  it('returns true for an error carrying the prerender-abort digest', () => {
    expect(isPrerenderInterrupt({ digest: 'HANGING_PROMISE_REJECTION' })).toBe(true)
  })

  it('returns true for a real Error with the digest attached', () => {
    const error = Object.assign(new Error('headers() rejected'), { digest: 'HANGING_PROMISE_REJECTION' })
    expect(isPrerenderInterrupt(error)).toBe(true)
  })

  it('returns false for an error with a different digest', () => {
    expect(isPrerenderInterrupt({ digest: 'NEXT_REDIRECT' })).toBe(false)
  })

  it('returns false for an ordinary Error with no digest', () => {
    expect(isPrerenderInterrupt(new Error('boom'))).toBe(false)
  })

  it.each([null, undefined, 'HANGING_PROMISE_REJECTION', 42])('returns false for non-object value %s', (value) => {
    expect(isPrerenderInterrupt(value)).toBe(false)
  })
})
