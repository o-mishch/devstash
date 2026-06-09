import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('resend', () => ({
  Resend: class MockResend {
    constructor() {}
  },
}))

describe('resend helpers', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
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
