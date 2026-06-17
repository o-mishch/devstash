import { describe, it, expect } from 'vitest'
import { getProfileAccountSummary, buildOwnedEmails } from './profile'

describe('profile db helpers', () => {
  describe('buildOwnedEmails', () => {
    it('deduplicates emails from primary, credentials, and OAuth accounts', () => {
      const user = {
        email: 'alice@example.com',
        credentialEmail: 'alice@example.com',
        credentialEmailVerified: new Date(),
        accounts: [
          { email: 'alice@example.com' },
          { email: 'bob@example.com' },
          { email: null },
        ],
      }

      const emails = buildOwnedEmails(user)
      expect(emails).toEqual(['alice@example.com', 'bob@example.com'])
    })
  })

  describe('getProfileAccountSummary', () => {
    it('deduplicates multiple accounts of the same OAuth provider', () => {
      const user = {
        email: 'alice@example.com',
        credentialEmail: null,
        credentialEmailVerified: null,
        hasPassword: true,
        accounts: [
          { id: '1', provider: 'github', email: 'alice@example.com' },
          { id: '2', provider: 'github', email: 'alice.work@example.com' },
          { id: '3', provider: 'google', email: 'alice@gmail.com' },
        ],
      }

      const summary = getProfileAccountSummary(user)
      expect(summary.accountTypes).toEqual(['Email', 'GitHub', 'Google'])
      expect(summary.availableEmails).toEqual([
        'alice@example.com',
        'alice.work@example.com',
        'alice@gmail.com',
      ])
    })

    it('handles no password and no accounts', () => {
      const user = {
        email: 'alice@example.com',
        credentialEmail: null,
        credentialEmailVerified: null,
        hasPassword: false,
        accounts: [],
      }

      const summary = getProfileAccountSummary(user)
      expect(summary.accountTypes).toEqual([])
      expect(summary.availableEmails).toEqual(['alice@example.com'])
    })
  })
})
