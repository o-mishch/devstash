import 'server-only'

import { prisma } from '@/lib/infra/prisma'
import { Prisma } from '@/generated/prisma'
import { resolveMatchedVerification, primaryEmailMovesWithCredential } from '@/lib/utils/auth'

// Matches ANY user already holding `email` as their primary `email`, `credentialEmail`, or linked
// OAuth `Account.email`. The DB unique index only guards credentialEmail↔credentialEmail, so this
// check also covers a clash with another user's primary `email` or linked address.
function emailTakenWhere(email: string): Prisma.UserWhereInput {
  return { OR: [{ email }, { credentialEmail: email }, { accounts: { some: { email } } }] }
}

// Shared collision probe for every credential-email write: same as `emailTakenWhere` but excludes the
// caller (`userId`) so a user requesting their OWN owned address is not falsely blocked.
function emailTakenByAnotherWhere(userId: string, email: string): Prisma.UserWhereInput {
  return { id: { not: userId }, ...emailTakenWhere(email) }
}

// Maps the authoritative Prisma error from a credential-email write to a caller status: P2002 is the
// unique-index backstop for a concurrent confirm racing on the same credentialEmail (→ 'in-use'),
// P2025 means the user row was deleted after the token was issued (→ 'not-found'). Anything else
// rethrows. `instanceof` on a Prisma library error type is the sanctioned exception to the
// no-instanceof-routing rule (coding-standards § Errors): these are authoritative DB outcomes.
function mapCredentialWriteError(error: unknown): 'in-use' | 'not-found' {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return 'in-use'
    if (error.code === 'P2025') return 'not-found'
  }
  throw error
}

export async function getUserSessionInfo(id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      password: true,
      isPro: true,
      stripeSubscriptionId: true,
      stripeLastSyncAt: true,
    },
  })
}

export async function createUser(data: Prisma.UserCreateInput | Prisma.UserUncheckedCreateInput) {
  return prisma.user.create({ data })
}

// Transactional create for a credentials sign-up. Re-runs the cross-column collision probe inside the
// txn and treats the unique-index P2002 as the authoritative backstop, so two concurrent sign-ups (or
// a sign-up racing a credential-email confirm) can't both land the same address across the `email` and
// `credentialEmail` columns — the gap a bare `findUserByAnyEmail` + `create` left open. Returns 'in-use'
// on collision so the caller can fall back to the enumeration-safe existing-account handling.
export async function createCredentialUser(data: Prisma.UserUncheckedCreateInput): Promise<'ok' | 'in-use'> {
  try {
    return await prisma.$transaction(async (tx) => {
      const conflict = await tx.user.findFirst({
        where: emailTakenWhere(data.email),
        select: { id: true },
      })
      if (conflict) return 'in-use'
      await tx.user.create({ data })
      return 'ok'
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return 'in-use'
    throw error
  }
}

// Auth/security reads in this file are intentionally uncached: they gate login, credential
// verification, password state, or write-conflict decisions and must reflect the latest committed row.

// Returns the user if they exist but haven't linked the given OAuth provider yet.
// Returns null if no user with that email exists, or they already have the provider linked.
// Matches on User.email OR any linked Account.email so that a user whose primary email
// differs from their OAuth provider email is still detected as a conflict.
export async function getUserWithOAuthConflict(email: string, provider: string) {
  return prisma.user.findFirst({
    where: {
      OR: [
        { email },
        { accounts: { some: { email } } },
        // Resolve via a verified credential-login email too, so a later OAuth sign-up with that
        // address is detected as a conflict instead of creating a duplicate user.
        { credentialEmail: email, credentialEmailVerified: { not: null } },
      ],
      accounts: { none: { provider } },
    },
    select: { id: true, email: true, password: true },
  })
}

const AUTH_INFO_SELECT = {
  id: true,
  email: true,
  name: true,
  image: true,
  password: true,
  emailVerified: true,
  credentialEmail: true,
  credentialEmailVerified: true,
} satisfies Prisma.UserSelect

// Resolves the account that can log in with `email` — either the OAuth identity `email` or a
// VERIFIED `credentialEmail`. Reports which field matched plus that field's verified timestamp, so
// `authorize` can gate on the right one (email → emailVerified, credentialEmail →
// credentialEmailVerified). An unverified `credentialEmail` never participates.
//
// `email` and `credentialEmail` are both unique columns, so the only way a single address can match
// two distinct rows is the cross-column case (one user's primary `email` equals another's
// `credentialEmail`). Resolving the primary-email owner first (via the unique index) makes login
// deterministic instead of depending on an unordered `findFirst`.
export async function getUserAuthInfoByEmail(email: string) {
  const user =
    (await prisma.user.findUnique({ where: { email }, select: AUTH_INFO_SELECT })) ??
    (await prisma.user.findFirst({
      where: { credentialEmail: email, credentialEmailVerified: { not: null } },
      select: AUTH_INFO_SELECT,
    }))
  if (!user) return null

  // Matched-field + verified-timestamp rule lives in the unit-tested `resolveMatchedVerification`.
  return { ...user, ...resolveMatchedVerification(user, email) }
}

// Resolves a user by their primary User.email OR any linked Account.email (different-email OAuth
// links), so password recovery / registration can be reached via any address the user owns. The
// caller always acts on the returned primary `email`, never the typed input.
export async function findUserByAnyEmail(email: string) {
  const select = { id: true, email: true, password: true, emailVerified: true } satisfies Prisma.UserSelect
  // Both `email` and `credentialEmail` are unique, so resolve them via the unique index first (in that
  // priority) before the non-unique linked-account match — deterministic instead of an unordered OR.
  return (
    (await prisma.user.findUnique({ where: { email }, select })) ??
    // A verified credential-login email is also an owned address, so password recovery /
    // register-over-existing can reach the account through it (the email still targets the primary
    // inbox). Unverified addresses never participate.
    (await prisma.user.findFirst({
      where: { credentialEmail: email, credentialEmailVerified: { not: null } },
      select,
    })) ??
    (await prisma.user.findFirst({ where: { accounts: { some: { email } } }, select }))
  )
}

// True if `email` is already used as ANOTHER user's primary `email`, confirmed `credentialEmail`, or
// linked OAuth `Account.email`. The caller (`userId`) is excluded, so a user requesting their OWN
// owned address is not falsely blocked — they can promote it to a credential login instead of hitting
// a silent no-op. A pending request lives only in Redis (not the User table), so it isn't reflected
// here — fine, the confirm transaction is authoritative. UX pre-check for the credential-email request.
export async function isEmailTakenByAnotherUser(userId: string, email: string): Promise<boolean> {
  const user = await prisma.user.findFirst({
    where: emailTakenByAnotherWhere(userId, email),
    select: { id: true },
  })
  return user !== null
}

export async function getUserAuthMethods(id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: {
      email: true,
      credentialEmail: true,
      password: true,
      accounts: { select: { id: true, provider: true, email: true } },
    },
  })
}

export async function deleteUserById(id: string) {
  return prisma.user.delete({ where: { id } })
}

export async function checkAccountExists(accountId: string, userId: string) {
  return prisma.account.findFirst({
    where: { id: accountId, userId },
    select: { id: true }
  })
}

export async function getUserById(id: string) {
  return prisma.user.findUnique({ where: { id }, select: { id: true, email: true } })
}

export async function checkProviderAccountExists(provider: string, providerAccountId: string) {
  return prisma.account.findUnique({
    where: {
      provider_providerAccountId: {
        provider,
        providerAccountId,
      },
    },
    select: { id: true },
  })
}

// Returns the account with its owning userId so callers can detect cross-user conflicts.
export async function getProviderAccount(provider: string, providerAccountId: string) {
  return prisma.account.findUnique({
    where: { provider_providerAccountId: { provider, providerAccountId } },
    select: { id: true, userId: true },
  })
}

export async function createAccount(data: Prisma.AccountCreateInput | Prisma.AccountUncheckedCreateInput) {
  return prisma.account.create({ data })
}

// Marks the email verified after a verification token (now Redis-backed, consumed by the caller) is
// confirmed. `updateMany` so a stale token for a since-deleted user is a no-op rather than a throw.
// Keeps `credentialEmailVerified` in lockstep when the credential-login email IS the primary email
// (the credentials-registration case) so both fields verify together.
export async function markEmailVerifiedByEmail(email: string): Promise<void> {
  const verifiedAt = new Date()
  // One logical "verify" — run both updates atomically so a failure can't leave `emailVerified` set
  // while `credentialEmailVerified` stays null.
  await prisma.$transaction([
    prisma.user.updateMany({ where: { email }, data: { emailVerified: verifiedAt } }),
    prisma.user.updateMany({ where: { email, credentialEmail: email }, data: { credentialEmailVerified: verifiedAt } }),
  ])
}

export async function updateUserPassword(userId: string, hashed: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { password: hashed },
  })
}

// Sets the password AND marks the email verified. Used when a credential is bootstrapped via a
// proof-of-ownership flow (password-reset link to the primary inbox, or an authenticated in-app set)
// on an account whose `emailVerified` is null — otherwise `authorize` would block the new login.
export async function setPasswordAndVerifyEmail(userId: string, hashed: string): Promise<void> {
  const verifiedAt = new Date()
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { email: true, credentialEmail: true },
    })
    // Keep `credentialEmailVerified` in lockstep when the credential-login email IS the primary email
    // (the credentials-registration case) — otherwise the verified credential address is dropped from
    // the owned-email set even though login works via the primary match.
    const lockstep = user?.credentialEmail === user?.email
    await tx.user.update({
      where: { id: userId },
      data: { password: hashed, emailVerified: verifiedAt, ...(lockstep ? { credentialEmailVerified: verifiedAt } : {}) },
    })
  })
}

// First-time bootstrap of a credential (Email & Password) login on an EXISTING account — typically an
// OAuth account that gains a password by confirming a proof-of-ownership set-password link (registering
// Email & Password over the account's own email). Sets the password, marks the proven primary email
// verified, AND records that same address as the credential-login email (`email == credentialEmail`,
// matching the registration model) — merging the credential login into the account. The primary `email`
// itself is unchanged. No other user can hold `credentialEmail == email` while this account owns that
// `email` (the credential-email conflict checks forbid it), so the unique index is not contended here.
export async function bootstrapCredentialLogin(
  userId: string,
  hashed: string,
  email: string,
): Promise<'ok' | 'in-use'> {
  const verifiedAt = new Date()
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashed, emailVerified: verifiedAt, credentialEmail: email, credentialEmailVerified: verifiedAt },
    })
    return 'ok'
  } catch (error) {
    // The credentialEmail unique index can't normally be contended here because no other user can hold
    // `credentialEmail == email` while this account owns that `email`. If it somehow is, FAIL the
    // bootstrap rather than falling back to password+verified WITHOUT credentialEmail — that fallback
    // would leave the same address loginable via this account's primary `email` AND another account's
    // verified `credentialEmail` (a dual-address auth surface). The caller surfaces this as an invalid
    // link so the user retries instead of silently creating a second login path.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return 'in-use'
    throw error
  }
}

// Confirms a credential-login email: sets `password` + `credentialEmail` + `credentialEmailVerified`
// in one transaction. The DB unique index on `credentialEmail` only guards credentialEmail↔
// credentialEmail collisions, so the in-transaction existence check also covers a collision with
// another user's primary `email`; the P2002 catch is the authoritative backstop for a concurrent
// confirm racing on the same credentialEmail (TOCTOU-safe). Returns 'in-use' on either, or
// 'not-found' if the user was deleted after the token was issued — the single-use token is already
// spent, so the caller treats this as an invalid link rather than letting it surface as a 500.
export async function setCredentialEmailLogin(
  userId: string,
  hashed: string,
  email: string,
): Promise<'ok' | 'in-use' | 'not-found'> {
  try {
    return await prisma.$transaction(async (tx) => {
      const conflict = await tx.user.findFirst({
        where: emailTakenByAnotherWhere(userId, email),
        select: { id: true },
      })
      if (conflict) return 'in-use'

      await tx.user.update({
        where: { id: userId },
        data: { password: hashed, credentialEmail: email, credentialEmailVerified: new Date() },
      })
      return 'ok'
    })
  } catch (error) {
    return mapCredentialWriteError(error)
  }
}

// Re-points an existing credential login to a new verified `credentialEmail` in one transaction. The
// password is never touched. The primary `email` moves along with it WHEN it currently equals the
// credential email (credentials-origin; `credentialEmail` null is a legacy "same as primary") — so the
// old address stops being a valid login. When the user has deliberately diverged their default onto a
// different (OAuth) `email`, only the credential-login email moves and that default is left untouched.
// Same TOCTOU-safety story as `setCredentialEmailLogin`: the in-transaction existence check covers a
// collision with another user's primary `email`, and the P2002 catch is the authoritative backstop for
// the unique index on `credentialEmail`. Returns 'in-use' on a collision, or 'not-found' if the row
// vanished after the token was issued. Callers guarantee the user already has a password (re-point).
export interface ChangeCredentialEmailResult {
  status: 'ok' | 'in-use' | 'not-found'
  // True when the primary `User.email` moved with the credential email (in-sync account) — the caller
  // must then re-sync the Stripe customer email, like `applyOwnedEmailChange` does.
  emailMoved: boolean
  // The sign-in address as it was BEFORE the re-point (`credentialEmail` if set, else the legacy
  // primary `email`) — captured inside the txn. The caller sends the "sign-in email changed" security
  // alert here, NOT to the now-current primary, which has moved for an in-sync account.
  previousLoginEmail: string | null
}

export async function changeCredentialEmail(
  userId: string,
  email: string,
): Promise<ChangeCredentialEmailResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({
        where: { id: userId },
        select: { email: true, credentialEmail: true },
      })
      if (!current) return { status: 'not-found', emailMoved: false, previousLoginEmail: null }

      const conflict = await tx.user.findFirst({
        where: emailTakenByAnotherWhere(userId, email),
        select: { id: true },
      })
      if (conflict) return { status: 'in-use', emailMoved: false, previousLoginEmail: null }

      const verifiedAt = new Date()
      const primaryIsCredential = primaryEmailMovesWithCredential(current)
      // The address that could log in before this re-point — alert it, not the moved primary.
      const previousLoginEmail = current.credentialEmail ?? current.email

      await tx.user.update({
        where: { id: userId },
        data: {
          credentialEmail: email,
          credentialEmailVerified: verifiedAt,
          // In-sync account: move the primary email too (old address stops being a login) and keep its
          // `emailVerified` honest — the new address was just proven.
          ...(primaryIsCredential ? { email, emailVerified: verifiedAt } : {}),
        },
      })
      return { status: 'ok', emailMoved: primaryIsCredential, previousLoginEmail }
    })
  } catch (error) {
    return { status: mapCredentialWriteError(error), emailMoved: false, previousLoginEmail: null }
  }
}

export async function unlinkUserAccount(userId: string, accountId: string): Promise<void> {
  await prisma.account.delete({ where: { id: accountId, userId } })
}

// Unlinks the credential (Email & Password) login: clears the password, the separate verified
// credential-login email, and its verified timestamp in one atomic update, and sets the primary
// `email` to `email`. Callers pass a linked-account address when the current primary is the credential
// login email that's going away, so the account keeps a valid, owned primary email afterwards.
export async function removeCredentialLogin(userId: string, email: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { password: null, credentialEmail: null, credentialEmailVerified: null, email },
  })
}

/** Backfills OAuth account email when PrismaAdapter leaves it null. */
export async function backfillOAuthAccountEmail(
  provider: string,
  providerAccountId: string,
  email: string,
): Promise<void> {
  await prisma.account.updateMany({
    where: {
      provider,
      providerAccountId,
      email: null,
    },
    data: { email },
  })
}
