import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Resend } from 'resend'
import type { Logger } from 'pino'

const mockSend = vi.fn<InstanceType<typeof Resend>['emails']['send']>()

vi.mock('resend', () => ({
  Resend: class MockResend {
    emails = { send: mockSend }
  },
}))

vi.mock('@/lib/infra/pino', () => ({
  logger: {
    child: () => ({ error: vi.fn<Logger['error']>(), info: vi.fn<Logger['info']>() }),
  },
}))

describe('resend helpers', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    mockSend.mockReset()
  })

  it('parseEmailAddress extracts the address from a formatted from value', async () => {
    const { parseEmailAddress } = await import('./resend')
    expect(parseEmailAddress('DevStash <billing@example.com>')).toBe('billing@example.com')
    expect(parseEmailAddress('plain@example.com')).toBe('plain@example.com')
  })

  it('getNotificationRecipientEmail returns null when EMAIL_FROM is unset', async () => {
    vi.stubEnv('EMAIL_FROM', '')
    const { getNotificationRecipientEmail } = await import('./resend')
    expect(getNotificationRecipientEmail()).toBeNull()
  })

  it('getNotificationRecipientEmail returns the bare address from EMAIL_FROM', async () => {
    vi.stubEnv('EMAIL_FROM', 'DevStash <alerts@example.com>')
    const { getNotificationRecipientEmail } = await import('./resend')
    expect(getNotificationRecipientEmail()).toBe('alerts@example.com')
  })
})

describe('sendEmail', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    // The Resend client is constructed lazily on first send and requires a key,
    // so an actual send path needs one present (the DISABLE_EMAIL_VERIFICATION
    // skip test overrides env itself and never reaches construction).
    vi.stubEnv('RESEND_API_KEY', 're_test_key')
    vi.resetModules()
    mockSend.mockReset()
    mockSend.mockResolvedValue({ error: null })
  })

  it('returns "skipped" without calling Resend when DISABLE_EMAIL_VERIFICATION is true', async () => {
    vi.stubEnv('DISABLE_EMAIL_VERIFICATION', 'true')
    const { sendEmail } = await import('./resend')
    const result = await sendEmail({
      to: 'user@example.com',
      subject: 'Test',
      html: '<p>hi</p>',
      idempotencyKey: 'test/key',
      operation: 'test',
    })
    expect(result).toBe('skipped')
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('returns "sent" on a successful Resend call', async () => {
    const { sendEmail } = await import('./resend')
    const result = await sendEmail({
      to: 'user@example.com',
      subject: 'Test',
      html: '<p>hi</p>',
      idempotencyKey: 'test/key',
      operation: 'test',
    })
    expect(result).toBe('sent')
    expect(mockSend).toHaveBeenCalledOnce()
  })

  it('returns "failed" when Resend reports an error', async () => {
    mockSend.mockResolvedValue({ error: { message: 'bounce' } })
    const { sendEmail } = await import('./resend')
    const result = await sendEmail({
      to: 'user@example.com',
      subject: 'Test',
      html: '<p>hi</p>',
      idempotencyKey: 'test/key',
      operation: 'test',
    })
    expect(result).toBe('failed')
    expect(mockSend).toHaveBeenCalledOnce()
  })
})
