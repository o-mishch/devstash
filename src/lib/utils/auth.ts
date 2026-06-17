import type { Profile } from 'next-auth'
import { SUPPORTED_OAUTH_PROVIDERS, type OAuthProvider } from '@/lib/utils/constants'

// --- Session Fingerprint Logic ---

export type FingerprintTransition = 'unchanged' | 'invalidate' | 'sync'

export function classifyPasswordFingerprint(
  prev: string | undefined,
  next: string,
): FingerprintTransition {
  if (prev === undefined || prev === next) return 'unchanged'

  const hadPassword = prev !== ''
  const hasPassword = next !== ''
  return hadPassword && hasPassword ? 'invalidate' : 'sync'
}

// --- OAuth Email Logic ---

export function oauthEmailIsVerified(provider: string, profile: Profile | undefined): boolean {
  if (!profile) return false

  if (provider === 'google') {
    const verified = (profile as { email_verified?: boolean | string }).email_verified
    return verified === true || verified === 'true'
  }

  if (provider === 'github') {
    // ACCEPTED RISK: GitHub's OAuth profile does not expose per-email verification status — confirming
    // it would require a separate `GET /user/emails` call with the `user:email` scope and the access
    // token, neither available here. The OAuth app only ever receives the account's PRIMARY email, and
    // a usable GitHub primary is verified in practice, so we treat a present email as verified for the
    // account-backfill / conflict-resolution paths. Tighten via `/user/emails` if this assumption ever
    // proves unsafe.
    return Boolean(profile.email)
  }

  return false
}

// --- Credential / Primary Email Logic ---

export function outboundEmailEnabled(): boolean {
  return process.env.DISABLE_EMAIL_VERIFICATION !== 'true'
}

export const emailVerificationEnabled = outboundEmailEnabled

export interface LinkedAccountEmail {
  provider: string
  email: string | null
}

export function pickLinkedEmailForPrimary(accounts: LinkedAccountEmail[]): string | undefined {
  const withEmail = accounts.filter(
    (account): account is { provider: string; email: string } => !!account.email,
  )
  withEmail.sort((a, b) => {
    const providerOrder = (provider: string) => {
      const index = SUPPORTED_OAUTH_PROVIDERS.indexOf(provider as OAuthProvider)
      return index === -1 ? SUPPORTED_OAUTH_PROVIDERS.length : index
    }
    const byProvider = providerOrder(a.provider) - providerOrder(b.provider)
    if (byProvider !== 0) return byProvider
    return a.email.localeCompare(b.email)
  })
  return withEmail[0]?.email
}

export interface CredentialEmailRow {
  email: string
  emailVerified: Date | null
  credentialEmail: string | null
  credentialEmailVerified: Date | null
}

export interface MatchedVerification {
  matchedField: 'email' | 'credentialEmail'
  matchedVerified: Date | null
}

export function resolveMatchedVerification(row: CredentialEmailRow, input: string): MatchedVerification {
  const verifiedByEmail = row.email === input ? row.emailVerified : null
  const verifiedByCredential = row.credentialEmail === input ? row.credentialEmailVerified : null
  const matchedByCredential = row.email !== input && row.credentialEmail === input
  return {
    matchedField: matchedByCredential ? 'credentialEmail' : 'email',
    matchedVerified: verifiedByEmail ?? verifiedByCredential,
  }
}

export interface PrimaryEmailMoveState {
  email: string
  credentialEmail: string | null
}

export function primaryEmailMovesWithCredential(current: PrimaryEmailMoveState): boolean {
  return current.credentialEmail === null || current.credentialEmail === current.email
}

export const CREDENTIAL_EMAIL_PRIMARY_MOVE_NOTE =
  ' If this is also your default email, that will move too.'

export function credentialEmailPrimaryMoveNote(movesPrimary: boolean): string {
  return movesPrimary ? CREDENTIAL_EMAIL_PRIMARY_MOVE_NOTE : ''
}

export interface ProfileEmailsPreviewState {
  currentEmail: string
  availableEmails: string[]
  credentialEmail: string | null
  linkedAccounts: LinkedAccountEmail[]
}

export function previewCredentialEmailChange(
  state: ProfileEmailsPreviewState,
  newEmail: string,
): Partial<Pick<ProfileEmailsPreviewState, 'credentialEmail' | 'availableEmails' | 'currentEmail'>> {
  const old = state.credentialEmail
  const oldIsLinked = old !== null && state.linkedAccounts.some((a) => a.email === old)
  const keepOld = old === null || old === newEmail || old === state.currentEmail || oldIsLinked
  const withoutOld = keepOld ? state.availableEmails : state.availableEmails.filter((e) => e !== old)
  const availableEmails = withoutOld.includes(newEmail) ? withoutOld : [...withoutOld, newEmail]
  const emailMoved = primaryEmailMovesWithCredential({ email: state.currentEmail, credentialEmail: old })
  return {
    credentialEmail: newEmail,
    availableEmails,
    ...(emailMoved ? { currentEmail: newEmail } : {}),
  }
}

export function previewCredentialEmailRemoval(state: ProfileEmailsPreviewState): {
  hasCredentialLogin: false
  credentialEmail: null
  availableEmails: string[]
  currentEmail: string
} {
  const old = state.credentialEmail
  const oldIsLinked = old !== null && state.linkedAccounts.some((a) => a.email === old)
  const availableEmails = oldIsLinked
    ? state.availableEmails
    : state.availableEmails.filter((email) => email !== old)
  const movePrimary = old !== null && state.currentEmail === old
  const currentEmail = movePrimary
    ? pickLinkedEmailForPrimary(state.linkedAccounts) ?? state.currentEmail
    : state.currentEmail
  return { hasCredentialLogin: false, credentialEmail: null, availableEmails, currentEmail }
}
