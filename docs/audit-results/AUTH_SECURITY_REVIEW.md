# Authentication Security Audit

**Last Audit Date**: 2026-06-01
**Auditor**: Auth Security Agent

## Executive Summary

The DevStash authentication implementation is well-architected and demonstrates good security instincts throughout. Password hashing is strong, token generation is cryptographically secure, anti-enumeration protections are consistently applied, and rate limiting covers the majority of the auth surface. Three genuine issues were found: active sessions are not invalidated after a password reset or profile password change (other sessions remain valid after credential rotation), the `changePasswordAction` has no rate limit (enabling brute-force of the current password), and the inline `resendVerification` Server Action on the `/verify-email` expired-token page bypasses all rate limiting. None of these are immediately critical in isolation, but the session-invalidation gap is high severity because it defeats the security intent of a password rotation.

---

## Findings

### High Severity

#### Active Sessions Not Invalidated After Password Reset or Password Change

**Severity**: High
**Files**: `src/lib/auth-service.ts` (lines 94-110), `src/actions/profile.ts` (lines 13-38)

**Vulnerable Code**:
```typescript
// auth-service.ts — applyPasswordReset
export async function applyPasswordReset(token: string, password: string): Promise<ApplyResetResult> {
  const record = await consumePasswordResetToken(token)
  if (!record) return 'invalid-token'
  const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS)
  await updateUserPassword(user.id, hashed)
  invalidateProfileCache(user.id)
  return 'ok'
  // No session invalidation — all existing JWTs remain valid
}

// profile.ts — changePasswordAction
await changeUserPassword(userId, newPassword)
return { success: true }
// No session invalidation — all other active sessions remain valid
```

**Problem**: After a password reset (forgotten password flow) or a voluntary password change (settings page), all existing JWT sessions for that user remain valid. The JWT callback in `auth.ts` only checks whether the user ID still exists in the database — it does not check a password version, credential change timestamp, or any revocation signal. An attacker who has hijacked a session retains full access even after the victim resets their password.

**Attack Scenario**: An attacker obtains a victim's session JWT (via a stolen cookie from a shared or compromised device). The victim notices suspicious activity and changes their password to lock the attacker out. Because the JWT is never invalidated server-side, the attacker's session continues working until it naturally expires. For the password reset flow specifically, this also means the victim's own stale sessions on other devices remain open after a reset.

**Fix**: Add a `passwordChangedAt` timestamp column to the User model. Embed it in the JWT at sign-in and compare it in the `jwt` callback. Any session issued before the latest password change is rejected.

```typescript
// 1. prisma/schema.prisma
model User {
  // ...existing fields
  passwordChangedAt DateTime?
}

// 2. auth-service.ts — set the timestamp whenever the password changes
// In changeUserPassword and applyPasswordReset, after bcrypt.hash:
await prisma.user.update({
  where: { id: userId },
  data: { password: hashed, passwordChangedAt: new Date() },
})

// 3. auth.ts — jwt callback
async jwt({ token, user }) {
  if (user) {
    token.id = user.id
    // Snapshot at sign-in time
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { passwordChangedAt: true },
    })
    token.passwordIssuedAt = dbUser?.passwordChangedAt?.getTime() ?? 0
  }

  if (token.id) {
    const dbUser = await prisma.user.findUnique({
      where: { id: token.id as string },
      select: { id: true, passwordChangedAt: true },
    })
    if (!dbUser) return null

    const currentChangedAt = dbUser.passwordChangedAt?.getTime() ?? 0
    if (currentChangedAt > (token.passwordIssuedAt as number)) {
      // Password was rotated after this token was issued — invalidate
      return null
    }
  }
  return token
},
```

---

### Medium Severity

#### `changePasswordAction` Has No Rate Limit

**Severity**: Medium
**File**: `src/actions/profile.ts` (lines 13-38)

**Vulnerable Code**:
```typescript
export async function changePasswordAction(
  _prevState: ActionState | null,
  formData: FormData
): Promise<ActionState> {
  return withAuth(async (userId) => {
    // No rate limit applied here
    const valid = await verifyUserPasswordById(userId, currentPassword)
    if (!valid) return { success: false, message: 'Current password is incorrect or not set.' }
    await changeUserPassword(userId, newPassword)
    return { success: true }
  })
}
```

**Problem**: An attacker who holds a valid session (e.g., from a shared or briefly stolen device) can submit unlimited password-change attempts against the `currentPassword` check. Each attempt is gated only by the cost of a bcrypt comparison, which the attacker can automate. All other sensitive auth actions (login, register, forgot-password, reset-password, link-account) have rate limits; `changePasswordAction` is the only one that does not.

**Attack Scenario**: Attacker gains brief access to a victim's session token (e.g., from a browser left open). The victim logs the attacker out remotely, but the attacker still holds the session token. Via the `changePasswordAction` endpoint, the attacker iterates dictionary-guessed `currentPassword` values at volume. A successful hit lets them rotate to a password they control, completing a full account takeover.

**Fix**: Add a new `changePassword` key to `LIMIT_CONFIG` in `src/lib/rate-limit.ts`, keyed by `userId` so IP rotation provides no benefit:

```typescript
// src/lib/rate-limit.ts — LIMIT_CONFIG
changePassword: { attempts: 5, window: '15 m' }, // keyed by userId

// src/actions/profile.ts
import { rateLimitAction } from '@/lib/rate-limit'

export async function changePasswordAction(...): Promise<ActionState> {
  return withAuth(async (userId) => {
    const rl = await rateLimitAction('changePassword', userId)
    if (rl) return rl

    // ...rest of existing logic unchanged
  })
}
```

---

#### Inline `resendVerification` Server Action on `/verify-email` Bypasses Rate Limiting

**Severity**: Medium
**File**: `src/app/(auth)/verify-email/page.tsx` (lines 72-86)

**Vulnerable Code**:
```typescript
function ResendButton({ email }: ResendButtonProps) {
  async function resend() {
    'use server'
    await resendVerification(email)  // No rate limit applied
    redirect('/sign-in?resent=1')
  }

  return (
    <form action={resend}>
      <button type="submit" ...>Resend verification email</button>
    </form>
  )
}
```

**Problem**: This inline Server Action calls `resendVerification` directly with no rate limiting. The canonical `POST /api/auth/resend-verification` endpoint (used from the sign-in page banner) applies both a broad IP bucket and a per-IP+email bucket. This code path, reached when a user lands on `/verify-email` with an expired token, completely bypasses those guards. The `email` value is passed in closure from the SSR render, so the rate-limiting gap is on the Server Action side, not user input.

**Attack Scenario**: An attacker who knows (or guesses) an unverified user's email can load `/verify-email?token=<any_valid_but_expired_token>`, which renders the expired-token UI with this form. Scripted POST submissions to the Server Action endpoint allow the attacker to flood that user's inbox with verification emails without any throttle.

**Fix**: Promote the inline function to module scope so `next/headers` is accessible and apply the same guards as the API route:

```typescript
// At module scope in verify-email/page.tsx (or extract to a server actions file)
async function resendAction(email: string) {
  'use server'
  const h = await headers()
  const ip = h.get('x-forwarded-for')?.split(',')[0].trim() ?? '127.0.0.1'

  const ipRl = await rateLimitAction('resendVerificationIP', ip)
  if (ipRl) return  // fail silently — no enumeration signal

  const emailRl = await rateLimitAction('resendVerification', `${ip}:${email}`)
  if (emailRl) return

  await resendVerification(email)
  redirect('/sign-in?resent=1')
}

// In ResendButton, bind the email and use the module-level action
function ResendButton({ email }: ResendButtonProps) {
  const action = resendAction.bind(null, email)
  return (
    <form action={action}>
      <button type="submit" ...>Resend verification email</button>
    </form>
  )
}
```

---

### Low Severity

#### Email Supplied by User Is Reflected in Redirect URL Without Format Validation

**Severity**: Low
**Files**: `src/actions/auth/register.ts` (line 29), `src/app/(auth)/register/page.tsx` (line 21)

**Vulnerable Code**:
```typescript
// register.ts
redirect(`/register?pending=1&email=${encodeURIComponent(email)}&sent=${...}`)

// register/page.tsx
<span className="font-medium text-foreground">{email}</span>
```

**Problem**: The `email` value from the registration form is URL-encoded and placed into a redirect, then rendered from `searchParams` into JSX. React escaping prevents XSS. However, there is no server-side email format validation before the redirect, so a malformed or very long string survives and is embedded in the URL and rendered in the page. A crafted link could produce misleading UI text in a phishing scenario, though only in the context of the user's own browser session (not a reflected attack against other users).

**Fix**: Add email format validation in `registerAction` before processing:

```typescript
// src/actions/auth/register.ts — after extracting fields
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
if (!emailRegex.test(email)) return { success: false, message: 'Please enter a valid email address.' }
```

---

## Passed Checks

The following security measures were verified as correctly implemented:

- **Strong password hashing**: bcryptjs with cost factor 12 (`BCRYPT_ROUNDS = 12`). Applied consistently at registration, password reset, and password change.
- **Password max length enforced**: `MAX_PASSWORD_LENGTH = 128` checked in `validatePassword` and again explicitly in `linkAccountAction`.
- **Minimum password length enforced**: 8-character minimum applied server-side in `validatePassword`.
- **Cryptographically secure token generation**: `randomBytes(32).toString('hex')` — 256 bits of entropy — used for all verification, password reset, and pending-link tokens.
- **Password reset tokens are single-use**: `consumePasswordResetToken` deletes the token from the DB before returning, preventing any reuse.
- **Password reset tokens expire in 1 hour**: `PASSWORD_RESET_TTL_MS = 60 * 60 * 1000`. Expired tokens are also cleaned up eagerly on attempted use by both `peekPasswordResetToken` and `consumePasswordResetToken`.
- **Email verification tokens expire in 24 hours** and are deleted on successful use: `verifyUserEmailAndToken` uses a Prisma `$transaction` that atomically updates the user and deletes the token in one operation.
- **Token namespace collision prevention**: Password-reset tokens use a `password-reset:` identifier prefix. The verify-email page explicitly rejects tokens carrying that prefix, preventing cross-type token reuse.
- **No email enumeration on registration**: `registerUser` returns `'sent'` for existing emails when verification is enabled — the caller sees no difference.
- **No email enumeration on forgot password**: `triggerPasswordReset` conditionally sends an email but `forgotPasswordAction` always redirects with the same response regardless of whether the email exists or has a password.
- **Consistent credential error message**: Both invalid email and invalid password return `'Invalid email or password.'` with no differentiation.
- **Rate limiting on login**: Keyed by `IP:email` (case-normalized with `.toLowerCase().trim()`), 5 attempts per 15 minutes. Prevents per-account brute force even with IP rotation.
- **Rate limiting on register, forgot-password, reset-password, resend-verification (API route), and link-account**: All covered with appropriate sliding-window configurations.
- **Fail-open rate limiting**: Redis/Upstash unavailability does not block legitimate users — `check()` returns `{ success: true }` on any error.
- **Session validation on all sensitive profile operations**: `withAuth` reads `session.user.id` from the NextAuth JWT and passes it to every mutation — user IDs from client input are never trusted.
- **Authorization on account unlinking**: `checkAccountExists(accountId, userId)` verifies the account row belongs to the authenticated user before deletion.
- **Guard against removing last auth method**: `unlinkProviderAction` counts total auth methods and rejects the request if only one remains, both server-side and client-side (button hidden).
- **Current password required before password change**: `changePasswordAction` calls `verifyUserPasswordById` with bcrypt before allowing the update.
- **Password required before OAuth account linking**: `linkAccountAction` calls `validateUserPassword` before creating the Account row.
- **Passwords never logged**: No `console.log` or logger call includes password values anywhere in the auth path.
- **No stack traces in error responses**: The route wrappers (`authedRoute`, `publicRoute`) catch all unhandled errors and return a generic 500 error response without internal details.
- **JWT session with DB presence check**: The `jwt` callback verifies the user ID still exists in the database on every token refresh, ensuring deleted accounts are immediately locked out.
- **Pending OAuth-link data stored in Redis, not in URL**: The full OAuth token payload is never exposed in a redirect; only an opaque 32-byte hex reference is passed via query string with a 15-minute TTL.
- **Verification token freshness reuse**: `resendVerification` reuses the existing token if it was issued less than 55 minutes ago, avoiding token thrashing while still allowing resend.

---

## Recommendations Summary

In priority order:

1. **[High] Invalidate sessions after password change and reset** — Add a `passwordChangedAt` column to the `User` model and compare it against a `passwordIssuedAt` claim in the JWT callback. Apply to both `applyPasswordReset` in `auth-service.ts` and `changeUserPassword` (called from `profile.ts`).

2. **[Medium] Rate-limit `changePasswordAction`** — Add a `changePassword` key to `LIMIT_CONFIG` in `rate-limit.ts`, keyed by `userId`, and apply it inside `changePasswordAction` before the bcrypt verification step.

3. **[Medium] Rate-limit the inline `resend` Server Action on `/verify-email`** — Promote the inline Server Action to module scope (or a dedicated server actions file) and apply the same `resendVerificationIP` and `resendVerification` rate-limit checks used by the API route.

4. **[Low] Add email format validation in `registerAction`** — Validate email format server-side before constructing the redirect URL to prevent malformed values flowing through to the UI.
