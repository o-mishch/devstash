import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Profile } from 'next-auth'
import {
  classifyPasswordFingerprint,
  oauthEmailIsVerified,
  outboundEmailEnabled,
  emailVerificationEnabled,
  pickLinkedEmailForPrimary,
  resolveMatchedVerification,
  primaryEmailMovesWithCredential,
  credentialEmailPrimaryMoveNote,
  CREDENTIAL_EMAIL_PRIMARY_MOVE_NOTE,
  previewCredentialEmailChange,
  previewCredentialEmailRemoval,
} from './auth'

describe('classifyPasswordFingerprint', () => {
  it('is unchanged when there is no prior snapshot (legacy token)', () => {
    expect(classifyPasswordFingerprint(undefined, 'abc12345')).toBe('unchanged')
  })

  it('is unchanged when the fingerprint is identical', () => {
    expect(classifyPasswordFingerprint('abc12345', 'abc12345')).toBe('unchanged')
  })

  it('invalidates when an existing password is rotated (both non-empty, different)', () => {
    expect(classifyPasswordFingerprint('old00000', 'new11111')).toBe('invalidate')
  })

  it('syncs (does not invalidate) when a password is ADDED to an OAuth-only account', () => {
    expect(classifyPasswordFingerprint('', 'new11111')).toBe('sync')
  })

  it('syncs (does not invalidate) when a password is REMOVED', () => {
    expect(classifyPasswordFingerprint('old00000', '')).toBe('sync')
  })
})

describe('oauthEmailIsVerified', () => {
  it('trusts a Google email only when email_verified is asserted', () => {
    expect(oauthEmailIsVerified('google', { email: 'a@b.com', email_verified: true } as Profile)).toBe(true)
    expect(oauthEmailIsVerified('google', { email: 'a@b.com', email_verified: 'true' } as unknown as Profile)).toBe(true)
  })

  it('does NOT trust a Google email when verification is absent or false', () => {
    expect(oauthEmailIsVerified('google', { email: 'a@b.com', email_verified: false } as Profile)).toBe(false)
    expect(oauthEmailIsVerified('google', { email: 'a@b.com' } as Profile)).toBe(false)
  })

  it('trusts a GitHub email when the (verified) primary email is present', () => {
    expect(oauthEmailIsVerified('github', { email: 'a@b.com' } as Profile)).toBe(true)
    expect(oauthEmailIsVerified('github', { email: null } as unknown as Profile)).toBe(false)
  })

  it('falls back to not-verified for a missing profile or unknown provider', () => {
    expect(oauthEmailIsVerified('google', undefined)).toBe(false)
    expect(oauthEmailIsVerified('discord', { email: 'a@b.com' } as Profile)).toBe(false)
  })
})

const VERIFIED = new Date('2026-01-01T00:00:00Z')

describe('outboundEmailEnabled', () => {
  beforeEach(() => vi.unstubAllEnvs())

  it('returns true when DISABLE_EMAIL_VERIFICATION is unset', () => {
    expect(outboundEmailEnabled()).toBe(true)
  })

  it('returns false when DISABLE_EMAIL_VERIFICATION is true', () => {
    vi.stubEnv('DISABLE_EMAIL_VERIFICATION', 'true')
    expect(outboundEmailEnabled()).toBe(false)
  })

  it('aliases emailVerificationEnabled to the same flag', () => {
    vi.stubEnv('DISABLE_EMAIL_VERIFICATION', 'true')
    expect(emailVerificationEnabled()).toBe(outboundEmailEnabled())
  })
})

describe('pickLinkedEmailForPrimary', () => {
  it('returns undefined when no linked accounts have an email', () => {
    expect(pickLinkedEmailForPrimary([
      { provider: 'google', email: null },
      { provider: 'github', email: null },
    ])).toBeUndefined()
  })

  it('returns the only linked email', () => {
    expect(pickLinkedEmailForPrimary([
      { provider: 'google', email: 'user@gmail.com' },
      { provider: 'github', email: null },
    ])).toBe('user@gmail.com')
  })

  it('prefers providers in SUPPORTED_OAUTH_PROVIDERS order', () => {
    expect(pickLinkedEmailForPrimary([
      { provider: 'google', email: 'g@example.com' },
      { provider: 'github', email: 'gh@example.com' },
    ])).toBe('gh@example.com')
  })

  it('breaks ties on the same provider by locale email sort', () => {
    expect(pickLinkedEmailForPrimary([
      { provider: 'google', email: 'z@example.com' },
      { provider: 'google', email: 'a@example.com' },
    ])).toBe('a@example.com')
  })

  it('sorts unknown providers after supported ones', () => {
    expect(pickLinkedEmailForPrimary([
      { provider: 'unknown', email: 'u@example.com' },
      { provider: 'github', email: 'gh@example.com' },
    ])).toBe('gh@example.com')
  })
})

describe('resolveMatchedVerification', () => {
  it('matches the primary email and reports its verified timestamp', () => {
    expect(
      resolveMatchedVerification(
        { email: 'a@x.com', emailVerified: VERIFIED, credentialEmail: null, credentialEmailVerified: null },
        'a@x.com',
      ),
    ).toEqual({ matchedField: 'email', matchedVerified: VERIFIED })
  })

  it('reports unverified when the primary email matches but is not verified', () => {
    expect(
      resolveMatchedVerification(
        { email: 'a@x.com', emailVerified: null, credentialEmail: null, credentialEmailVerified: null },
        'a@x.com',
      ),
    ).toEqual({ matchedField: 'email', matchedVerified: null })
  })

  it('matches a verified credential email that differs from the primary (diverged account)', () => {
    expect(
      resolveMatchedVerification(
        { email: 'oauth@x.com', emailVerified: null, credentialEmail: 'cred@x.com', credentialEmailVerified: VERIFIED },
        'cred@x.com',
      ),
    ).toEqual({ matchedField: 'credentialEmail', matchedVerified: VERIFIED })
  })

  it('treats a promoted credential email as verified even when the stale primary emailVerified is null', () => {
    const r = resolveMatchedVerification(
      { email: 'same@x.com', emailVerified: null, credentialEmail: 'same@x.com', credentialEmailVerified: VERIFIED },
      'same@x.com',
    )
    expect(r.matchedField).toBe('email')
    expect(r.matchedVerified).toBe(VERIFIED)
  })

  it('reports unverified when the primary matches unverified and there is no credential match', () => {
    expect(
      resolveMatchedVerification(
        { email: 'a@x.com', emailVerified: null, credentialEmail: 'other@x.com', credentialEmailVerified: VERIFIED },
        'a@x.com',
      ).matchedVerified,
    ).toBeNull()
  })
})

describe('primaryEmailMovesWithCredential', () => {
  it('moves when email == credentialEmail (in-sync, credentials-origin)', () => {
    expect(primaryEmailMovesWithCredential({ email: 'a@x.com', credentialEmail: 'a@x.com' })).toBe(true)
  })

  it('moves when credentialEmail is null (legacy "same as primary")', () => {
    expect(primaryEmailMovesWithCredential({ email: 'a@x.com', credentialEmail: null })).toBe(true)
  })

  it('does not move when the default has diverged onto a different address', () => {
    expect(primaryEmailMovesWithCredential({ email: 'oauth@x.com', credentialEmail: 'cred@x.com' })).toBe(false)
  })
})

describe('credentialEmailPrimaryMoveNote', () => {
  it('returns the shared note when the primary moves with the credential email', () => {
    expect(credentialEmailPrimaryMoveNote(true)).toBe(CREDENTIAL_EMAIL_PRIMARY_MOVE_NOTE)
  })

  it('returns an empty string when the primary stays put', () => {
    expect(credentialEmailPrimaryMoveNote(false)).toBe('')
  })
})

describe('previewCredentialEmailChange', () => {
  const base = {
    currentEmail: 'primary@x.com',
    availableEmails: ['primary@x.com', 'old@x.com'],
    credentialEmail: 'old@x.com' as string | null,
    linkedAccounts: [],
  }

  it('moves the primary when in sync with the credential email', () => {
    expect(previewCredentialEmailChange({
      currentEmail: 'old@x.com',
      availableEmails: ['old@x.com'],
      credentialEmail: 'old@x.com',
      linkedAccounts: [],
    }, 'new@x.com')).toEqual({
      credentialEmail: 'new@x.com',
      availableEmails: ['old@x.com', 'new@x.com'],
      currentEmail: 'new@x.com',
    })
  })

  it('leaves the primary when it has diverged', () => {
    expect(previewCredentialEmailChange(base, 'new@x.com')).toEqual({
      credentialEmail: 'new@x.com',
      availableEmails: ['primary@x.com', 'new@x.com'],
    })
  })
})

describe('previewCredentialEmailRemoval', () => {
  it('falls back to a linked OAuth email when the primary was the credential email', () => {
    expect(
      previewCredentialEmailRemoval({
        currentEmail: 'login@x.com',
        availableEmails: ['login@x.com', 'oauth@x.com'],
        credentialEmail: 'login@x.com',
        linkedAccounts: [{ id: 'acc-1', provider: 'github', email: 'oauth@x.com' }],
      }),
    ).toEqual({
      hasCredentialLogin: false,
      credentialEmail: null,
      availableEmails: ['oauth@x.com'],
      currentEmail: 'oauth@x.com',
    })
  })
})
