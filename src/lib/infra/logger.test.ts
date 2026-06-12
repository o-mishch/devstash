import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createLogger, toErrorMessage } from './logger'

// When createLogger() is called from this file, callerTag() resolves "logger.test"
const AUTO_TAG = 'logger.test'

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

  it('auto-detects tag from caller filename', () => {
    const log = createLogger()
    log.info('hello')
    expect(logSpy).toHaveBeenCalledWith(`[${AUTO_TAG}] INFO hello`)
  })

  it('info calls console.log with [tag] INFO prefix', () => {
    const log = createLogger()
    log.info('created "My Snippet" [snippet]')
    expect(logSpy).toHaveBeenCalledWith(`[${AUTO_TAG}] INFO created "My Snippet" [snippet]`)
  })

  it('warn calls console.warn with [tag] WARN prefix', () => {
    const log = createLogger()
    log.warn('filebase fetch failed for item:abc (120ms)')
    expect(warnSpy).toHaveBeenCalledWith(`[${AUTO_TAG}] WARN filebase fetch failed for item:abc (120ms)`)
  })

  it('error without context passes only the message to console.error', () => {
    const log = createLogger()
    log.error('unhandled route error')
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy.mock.calls[0][0]).toBe(`[${AUTO_TAG}] ERROR unhandled route error`)
  })

  it('error with LogContext embeds key=value pairs in the message', () => {
    const log = createLogger()
    log.error('delete failed: user/abc/file.png', { userId: 'abc', reason: 'S3 connection refused' })
    expect(errorSpy).toHaveBeenCalledWith(
      `[${AUTO_TAG}] ERROR delete failed: user/abc/file.png | userId="abc" reason="S3 connection refused"`
    )
  })

  it('error with Error instance embeds error message in the log', () => {
    const log = createLogger()
    log.error('delete failed: user/abc/file.png', new Error('S3 connection refused'))
    expect(errorSpy).toHaveBeenCalledWith(
      `[${AUTO_TAG}] ERROR delete failed: user/abc/file.png | error="S3 connection refused"`
    )
  })

  it('info with context embeds key=value pairs in the message', () => {
    const log = createLogger()
    log.info('item created', { itemId: '123', type: 'snippet' })
    expect(logSpy).toHaveBeenCalledWith(
      `[${AUTO_TAG}] INFO item created | itemId="123" type="snippet"`
    )
  })

  it('info with context and description appends description last', () => {
    const log = createLogger()
    log.info('invoice.payment_succeeded', { eventId: 'evt_123' }, 'Occurs whenever an invoice payment attempt succeeds.')
    expect(logSpy).toHaveBeenCalledWith(
      `[${AUTO_TAG}] INFO invoice.payment_succeeded | eventId="evt_123" | Occurs whenever an invoice payment attempt succeeds.`
    )
  })

  it('warn with context embeds key=value pairs in the message', () => {
    const log = createLogger()
    log.warn('rate limit hit', { ip: '1.2.3.4', limit: 5 })
    expect(warnSpy).toHaveBeenCalledWith(
      `[${AUTO_TAG}] WARN rate limit hit | ip="1.2.3.4" limit=5`
    )
  })

  it('explicit tag overrides auto-detection', () => {
    const log = createLogger('custom')
    log.info('hello')
    expect(logSpy).toHaveBeenCalledWith('[custom] INFO hello')
  })

  it('includes HH:MM:SS timestamp and level label in development mode', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.resetModules()
    const { createLogger: createDev } = await import('./logger')
    const log = createDev()
    log.info('MISS user:abc:pinned-items')
    const [msg] = logSpy.mock.calls[0]
    // strip ANSI escape codes before matching
    const plain = (msg as string).replace(/\x1b\[\d+m/g, '')
    expect(plain).toMatch(/^\d{2}:\d{2}:\d{2}:\d{3}:\d{6} \[[\w.]+\] INFO MISS user:abc:pinned-items$/)
    vi.unstubAllEnvs()
  })
})

describe('toErrorMessage', () => {
  it('returns Error.message for Error instances', () => {
    expect(toErrorMessage(new Error('boom'))).toBe('boom')
  })

  it('returns fallback for non-Error values', () => {
    expect(toErrorMessage('plain', 'fallback')).toBe('fallback')
    expect(toErrorMessage(42)).toBe('42')
  })
})
