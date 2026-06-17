import 'server-only'

import { createHash, randomBytes } from 'crypto'
import { getRedis } from '@/lib/infra/redis'

// Single-use, TTL-bound auth tokens, stored in Upstash Redis (not the Prisma VerificationToken
// table — that model stays declared only to satisfy the Auth.js PrismaAdapter contract; Auth.js
// itself never touches it under our jwt + Credentials + OAuth setup). Redis gives us native
// expiry (`ex`) and an atomic single-use consume (`getdel`). Only the SHA-256 hash of the raw token
// is ever stored — the raw token lives solely in the emailed URL — so a Redis-read leak can't be
// replayed. Mirrors the OAuth pending-link pattern already in `pending-link.ts`.

const PASSWORD_RESET_TTL_S = 60 * 60          // 1 hour
const CREDENTIAL_EMAIL_TTL_S = 60 * 60        // 1 hour
const VERIFICATION_TTL_S = 60 * 60 * 24       // 24 hours
const VERIFICATION_RESEND_WINDOW_S = 55 * 60  // anti-spam: suppress re-sends within this window

// Key namespaces. Token keys are `${ns}:${hashToken(raw)}`.
const NS = {
  verifyEmail: 'auth:verify-email',
  verifySent: 'auth:verify-sent',
  passwordReset: 'auth:password-reset',
  credentialEmail: 'auth:credential-email',
  credentialEmailGen: 'auth:credential-email-gen',
} as const

interface EmailPayload {
  email: string
}

// `mode` captures the request-time intent for email copy and initial confirm-page rendering:
//  - 'add'    → the user has no credential login yet; the confirm page collects a password.
//  - 'change' → the user already has a password and is re-pointing their sign-in email; the confirm
//               page only re-verifies ownership of the new address (no new password, primary email
//               and password untouched).
export type CredentialEmailMode = 'add' | 'change'

interface CredentialEmailPayload {
  userId: string
  email: string
  mode: CredentialEmailMode
  /** Monotonic per-user generation — only the latest issued link is valid (atomic INCR). */
  gen: number
}

export function generateSecureToken(): string {
  return randomBytes(32).toString('hex')
}

/** One-way hash for token storage at rest. 256-bit raw entropy makes a fast SHA-256 safe. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// Issuing a token must fail loudly when Redis is down — a token we can't persist would email a dead
// link. Callers that issue tokens are either awaited at a boundary that surfaces the error, or run
// inside `after()` (forgot-password) where the throw is logged and swallowed without leaking.
function requireRedis() {
  const redis = getRedis()
  if (!redis) throw new Error('Redis unavailable — cannot issue auth token')
  return redis
}

async function storeToken<T>(ns: string, raw: string, payload: T, ttlSeconds: number): Promise<void> {
  await requireRedis().set(`${ns}:${hashToken(raw)}`, payload, { ex: ttlSeconds })
}

// Reading a token tolerates a Redis outage by treating the token as absent (→ "invalid or expired"),
// so a public page degrades gracefully instead of throwing a 500.
async function readToken<T>(ns: string, raw: string): Promise<T | null> {
  const redis = getRedis()
  if (!redis) return null
  return redis.get<T>(`${ns}:${hashToken(raw)}`)
}

// Atomic single-use consume — GETDEL returns the value and deletes it in one round-trip, so two
// concurrent confirms can't both succeed.
async function takeToken<T>(ns: string, raw: string): Promise<T | null> {
  const redis = getRedis()
  if (!redis) return null
  return redis.getdel<T>(`${ns}:${hashToken(raw)}`)
}

// ── Email verification ─────────────────────────────────────────────────────
export async function createVerificationToken(email: string): Promise<string> {
  const token = generateSecureToken()
  await storeToken<EmailPayload>(NS.verifyEmail, token, { email }, VERIFICATION_TTL_S)
  // Anti-spam marker (own short TTL) so resend can detect a recent send without minting a new token.
  await requireRedis().set(`${NS.verifySent}:${email}`, 1, { ex: VERIFICATION_RESEND_WINDOW_S })
  return token
}

export async function verificationRecentlySent(email: string): Promise<boolean> {
  const redis = getRedis()
  if (!redis) return false
  return (await redis.get(`${NS.verifySent}:${email}`)) !== null
}

export async function consumeVerificationToken(token: string): Promise<EmailPayload | null> {
  return takeToken<EmailPayload>(NS.verifyEmail, token)
}

// ── Password reset ───────────────────────────────────────────────────────────
export async function createPasswordResetToken(email: string): Promise<string> {
  const token = generateSecureToken()
  await storeToken<EmailPayload>(NS.passwordReset, token, { email }, PASSWORD_RESET_TTL_S)
  return token
}

export async function peekPasswordResetToken(token: string): Promise<'valid' | 'invalid'> {
  return (await readToken<EmailPayload>(NS.passwordReset, token)) ? 'valid' : 'invalid'
}

export async function consumePasswordResetToken(token: string): Promise<EmailPayload | null> {
  return takeToken<EmailPayload>(NS.passwordReset, token)
}

// ── Credential-login email confirmation ───────────────────────────────────────
async function currentCredentialEmailGen(userId: string): Promise<number | null> {
  const redis = getRedis()
  if (!redis) return null
  const gen = await redis.get<number>(`${NS.credentialEmailGen}:${userId}`)
  return gen ?? null
}

async function isCurrentCredentialEmailPayload(payload: CredentialEmailPayload): Promise<boolean> {
  const current = await currentCredentialEmailGen(payload.userId)
  return current !== null && payload.gen === current
}

export async function createCredentialEmailToken(
  userId: string,
  email: string,
  mode: CredentialEmailMode,
): Promise<string> {
  const redis = requireRedis()
  const genKey = `${NS.credentialEmailGen}:${userId}`
  const gen = await redis.incr(genKey)
  try {
    await redis.expire(genKey, CREDENTIAL_EMAIL_TTL_S)
    const token = generateSecureToken()
    await storeToken<CredentialEmailPayload>(NS.credentialEmail, token, { userId, email, mode, gen }, CREDENTIAL_EMAIL_TTL_S)
    return token
  } catch (error) {
    // The generation was already bumped (invalidating prior links). If the token persist fails on a
    // transient Redis blip, roll the generation back so the user isn't left with no valid link AND no
    // way to re-request — better than silently invalidating everything.
    await redis.decr(genKey).catch(() => {})
    throw error
  }
}

// Re-stores a previously consumed token under its original hash so a single-use link is not burned on
// a RECOVERABLE rejection (e.g. the confirm endpoint consumed the token, then found the ADD path needs
// a password the user hasn't supplied). The generation key is untouched, so the restored token stays
// current. Best-effort: a Redis outage here just leaves the link spent, the same as before.
export async function restoreCredentialEmailToken(
  token: string,
  payload: CredentialEmailPayload,
): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  await storeToken<CredentialEmailPayload>(NS.credentialEmail, token, payload, CREDENTIAL_EMAIL_TTL_S)
}

// Non-consuming read of the token payload so the public confirm page can render the right form. The
// page derives add-vs-change from the user's CURRENT password state (the same signal the confirm
// endpoint uses), so it needs the `userId` — not the token's stored `mode`, which only fixes the email
// copy at request time and can go stale if the password is added/removed before confirm. Returns null
// when the token is absent/expired.
// Atomic gen-check + GETDEL — stale superseded tokens cannot consume if INCR races between peek and take.
const CONSUME_CREDENTIAL_EMAIL_IF_CURRENT = `
local current = redis.call('GET', KEYS[1])
if not current or tonumber(current) ~= tonumber(ARGV[1]) then
  return nil
end
return redis.call('GETDEL', KEYS[2])
`

async function takeCredentialEmailIfCurrent(
  raw: string,
  payload: CredentialEmailPayload,
): Promise<boolean> {
  const redis = getRedis()
  if (!redis) return false
  const genKey = `${NS.credentialEmailGen}:${payload.userId}`
  const tokenKey = `${NS.credentialEmail}:${hashToken(raw)}`
  const result = await redis.eval(
    CONSUME_CREDENTIAL_EMAIL_IF_CURRENT,
    [genKey, tokenKey],
    [payload.gen],
  )
  return result !== null
}

export async function deleteCredentialEmailToken(token: string): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  await redis.del(`${NS.credentialEmail}:${hashToken(token)}`)
}

export async function peekCredentialEmailPayload(token: string): Promise<CredentialEmailPayload | null> {
  const payload = await readToken<CredentialEmailPayload>(NS.credentialEmail, token)
  if (!payload || !(await isCurrentCredentialEmailPayload(payload))) return null
  return payload
}

export async function consumeCredentialEmailToken(token: string): Promise<CredentialEmailPayload | null> {
  const payload = await readToken<CredentialEmailPayload>(NS.credentialEmail, token)
  if (!payload) return null
  const consumed = await takeCredentialEmailIfCurrent(token, payload)
  return consumed ? payload : null
}
