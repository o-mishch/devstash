import { vi, describe, it, expect, beforeEach } from 'vitest'
import { stringContaining } from '@/test/matchers'
import type { buildEmailTemplate } from './template-builder'
import type { getBaseUrl } from '@/lib/utils/url'
import type { sendEmail as SendEmailFn } from '@/lib/infra/resend'

vi.mock('./link-email.html', () => ({ default: '{{HEADING}}{{INTRO}}{{URL}}{{CTA}}{{DISCLAIMER}}' }))
vi.mock('./template-builder', () => ({
  buildEmailTemplate: vi.fn<typeof buildEmailTemplate>((_subject: string, body: string) => body),
}))
vi.mock('@/lib/utils/url', () => ({ getBaseUrl: vi.fn<typeof getBaseUrl>(() => 'https://app.example.com') }))
vi.mock('@/lib/infra/resend', () => ({ sendEmail: vi.fn<typeof SendEmailFn>().mockResolvedValue(true) }))

import { sendTokenLinkEmail } from './link-email'
import { sendEmail } from '@/lib/infra/resend'

const mockSendEmail = vi.mocked(sendEmail)

describe('sendTokenLinkEmail', () => {
  beforeEach(() => vi.clearAllMocks())

  it('builds the token URL and passes idempotency metadata to sendEmail', async () => {
    const ok = await sendTokenLinkEmail({
      to: 'user@example.com',
      token: 'abc123',
      path: 'verify-email',
      subject: 'Verify your email',
      heading: 'Verify',
      intro: 'Click the link.',
      cta: 'Verify',
      disclaimer: 'Ignore if not you.',
      keyPrefix: 'verify-email',
      operation: 'verification',
    })

    expect(ok).toBe(true)
    expect(mockSendEmail).toHaveBeenCalledWith({
      to: 'user@example.com',
      subject: 'Verify your email',
      html: stringContaining('https://app.example.com/verify-email?token=abc123'),
      idempotencyKey: 'verify-email/abc123',
      operation: 'verification',
    })
  })
})
