import { vi, describe, it, expect, beforeEach } from 'vitest'

// The module imports a raw `.html` template (no vitest loader) and the template builder (which imports
// another `.html`); mock both so the test exercises only the recipient-resolution branch.
vi.mock('./security-notification.html', () => ({ default: '{{HEADING}}{{MESSAGE}}{{SETTINGS_URL}}' }))
vi.mock('./template-builder', () => ({ buildEmailTemplate: (_subject: string, body: string) => body }))
vi.mock('@/lib/utils/url', () => ({ getBaseUrl: () => 'http://localhost:3000' }))
vi.mock('@/lib/infra/resend', () => ({ sendEmail: vi.fn() }))
vi.mock('@/lib/db/users', () => ({ getUserById: vi.fn() }))

import { sendSecurityNotification } from './security-notification'
import { sendEmail } from '@/lib/infra/resend'
import { getUserById } from '@/lib/db/users'

const mockSendEmail = sendEmail as ReturnType<typeof vi.fn>
const mockGetUserById = getUserById as ReturnType<typeof vi.fn>

describe('sendSecurityNotification recipient resolution', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends to the explicit `to` override and never resolves the current primary', async () => {
    await sendSecurityNotification('user-1', 'credential-email-changed', { to: 'old@example.com' })
    // Critical: an email change moves the primary, so resolving it would alert the NEW address.
    expect(mockGetUserById).not.toHaveBeenCalled()
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'old@example.com' }))
  })

  it('falls back to the account primary email when no override is given', async () => {
    mockGetUserById.mockResolvedValue({ id: 'user-1', email: 'primary@example.com' })
    await sendSecurityNotification('user-1', 'password-changed')
    expect(mockGetUserById).toHaveBeenCalledWith('user-1')
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'primary@example.com' }))
  })

  it('no-ops when neither an override nor a resolvable primary email exists', async () => {
    mockGetUserById.mockResolvedValue(null)
    await sendSecurityNotification('user-1', 'password-changed')
    expect(mockSendEmail).not.toHaveBeenCalled()
  })
})
