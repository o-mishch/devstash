import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSend = vi.fn()

vi.mock('resend', () => ({
  Resend: class MockResend {
    emails = { send: mockSend }
  },
}))

vi.mock('@/lib/infra/pino', () => ({
  logger: { child: () => ({ error: vi.fn(), info: vi.fn() }) },
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
