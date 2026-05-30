import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createLogger } from './logger'

describe('createLogger', () => {
  let logSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('info calls console.log with [tag] prefix', () => {
    const log = createLogger('items')
    log.info('created "My Snippet" [snippet]')
    expect(logSpy).toHaveBeenCalledWith('[items] created "My Snippet" [snippet]')
  })

  it('warn calls console.warn with [tag] prefix', () => {
    const log = createLogger('download')
    log.warn('filebase fetch failed for item:abc (120ms)')
    expect(warnSpy).toHaveBeenCalledWith('[download] filebase fetch failed for item:abc (120ms)')
  })

  it('error without err passes only the message to console.error', () => {
    const log = createLogger('api')
    log.error('unhandled route error')
    expect(errorSpy).toHaveBeenCalledTimes(1)
    const call = errorSpy.mock.calls[0]
    expect(call[0]).toBe('[api] unhandled route error')
    expect(call[1]).toBeUndefined()
  })

  it('error with err passes the error object as second arg to console.error', () => {
    const log = createLogger('filebase')
    const err = new Error('S3 connection refused')
    log.error('delete failed: user/abc/file.png', err)
    expect(errorSpy).toHaveBeenCalledWith('[filebase] delete failed: user/abc/file.png', err)
  })

  it('different tags produce independent scoped loggers', () => {
    const cache = createLogger('cache')
    const email = createLogger('email')
    cache.info('MISS user:abc:pinned-items')
    email.info('sent verification')
    expect(logSpy).toHaveBeenNthCalledWith(1, '[cache] MISS user:abc:pinned-items')
    expect(logSpy).toHaveBeenNthCalledWith(2, '[email] sent verification')
  })

  it('includes HH:MM:SS timestamp prefix in development mode', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.resetModules()
    const { createLogger: createDev } = await import('./logger')
    const log = createDev('cache')
    log.info('MISS user:abc:pinned-items')
    const [msg] = logSpy.mock.calls[0]
    expect(msg).toMatch(/^\d{2}:\d{2}:\d{2} \[cache\] MISS user:abc:pinned-items$/)
    vi.unstubAllEnvs()
  })
})
