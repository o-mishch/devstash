import type { Profile } from 'next-auth'

// Auth.js core guidance: never trust an email-based identity unless the provider verified it (and we
// deliberately do NOT enable `allowDangerousEmailAccountLinking`). The any-email-resolution paths
// (Cases 2/4) treat a match on `Account.email` as proof of ownership, so we only seed `Account.email`
// when the provider asserts the email is verified — otherwise we fall back to `User.email`-only.
// Blast radius is small (resets only ever land in the primary inbox), so this is defense-in-depth.
// (Case 6)
export function oauthEmailIsVerified(provider: string, profile: Profile | undefined): boolean {
  if (!profile) return false

  if (provider === 'google') {
    // Google's OIDC `email_verified` claim (boolean; some shapes serialize it as a string).
    const verified = (profile as { email_verified?: boolean | string }).email_verified
    return verified === true || verified === 'true'
  }

  if (provider === 'github') {
    // GitHub returns the primary email only once it has been verified on the account (the OAuth
    // profile carries no separate flag), so presence of `profile.email` is the verified signal.
    return Boolean(profile.email)
  }

  return false
}
