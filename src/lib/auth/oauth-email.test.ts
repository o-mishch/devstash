import { describe, it, expect } from 'vitest'
import type { Profile } from 'next-auth'
import { oauthEmailIsVerified } from './oauth-email'

describe('oauthEmailIsVerified (Case 6)', () => {
  it('trusts a Google email only when email_verified is asserted', () => {
    expect(oauthEmailIsVerified('google', { email: 'a@b.com', email_verified: true } as Profile)).toBe(true)
    // some shapes serialize the OIDC claim as a string
    expect(oauthEmailIsVerified('google', { email: 'a@b.com', email_verified: 'true' } as Profile)).toBe(true)
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
