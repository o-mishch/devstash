# Authentication Security Audit

**Last Audit Date**: 2026-05-26
**Auditor**: Auth Security Agent + Context7 Validation Pass

---

## Executive Summary

The authentication implementation is well-structured and demonstrates good security instincts: tokens use cryptographically secure randomness, password hashing uses bcrypt at cost 12, and enumeration prevention is present at the API layer. Three issues require attention before production: password reset does not invalidate existing JWT sessions, no rate limiting exists on any auth endpoint, and passwords have no maximum length cap (bcrypt DoS vector).

The initial audit flagged `proxy.ts` as a critical misconfiguration — this was a **false positive**. Next.js 16 renamed the middleware convention from `middleware.ts` → `proxy.ts` and the named export from `middleware` → `proxy`. The current code is correct for the version in use.

---

## Findings

### High Severity

---

#### Password Reset Does Not Invalidate Existing Sessions

**Severity**: High
**File**: `src/actions/auth.ts`, `src/app/api/auth/reset-password/route.ts`
**Lines (actions)**: 99-106; **Lines (route)**: 30-37

**Vulnerable Code**:

```typescript
// src/actions/auth.ts — resetPasswordAction
const hashed = await bcrypt.hash(password, 12)
await prisma.user.update({
  where: { id: user.id },
  data: { password: hashed },
})
return ApiResponse.OK()
// No session invalidation
```

```typescript
// src/app/api/auth/reset-password/route.ts
const hashed = await bcrypt.hash(password, 12)
await prisma.user.update({
  where: { id: user.id },
  data: { password: hashed },
})
return ApiResponse.OK('Password updated. You can now sign in.')
// No session invalidation
```

**Problem**: After a successful password reset, existing JWT sessions issued before the reset remain valid until their natural expiry. The `jwt` callback in `auth.ts` only checks that the user record still exists — it does not verify whether the password was changed after the token was issued. An attacker who previously stole a session token retains full access even after the legitimate user resets their password.

The NextAuth v5 docs explicitly acknowledge this as an inherent JWT limitation: *"Expiring a JSON Web Token before its encoded expiry is not possible — doing so requires maintaining a server-side blocklist."* The recommended mitigation is either shorter session TTLs or a DB-backed version check in the `jwt` callback.

**Attack Scenario**: An attacker obtains a victim's session JWT (via any means). The victim notices suspicious activity and resets their password. The attacker's stolen JWT continues to work because the server has no way to invalidate it short of a blocklist or version check.

**Fix**: Add a `passwordChangedAt` timestamp to the `User` model and compare it against a `passwordIssuedAt` claim stored in the JWT. The `jwt` callback already runs on every session retrieval (confirmed by NextAuth source), so this check is applied on every authenticated request without extra round-trips beyond the existing DB lookup.

```typescript

// 1. Add to Prisma schema:
// passwordChangedAt  DateTime?

// 2. On password update, also set the timestamp:
await prisma.user.update({
  where: { id: user.id },
  data: {
    password: hashed,
    passwordChangedAt: new Date(),
  },
})

// 3. In auth.ts jwt callback, embed the timestamp at sign-in and check on every request:
async jwt({ token, user }) {
  if (user) {
    token.id = user.id
    token.passwordIssuedAt = Date.now()
  }
  if (token.id) {
    const dbUser = await prisma.user.findUnique({
      where: { id: token.id as string },
      select: { id: true, passwordChangedAt: true },
    })
    if (!dbUser) return null
    if (
      dbUser.passwordChangedAt &&
      token.passwordIssuedAt &&
      dbUser.passwordChangedAt.getTime() > (token.passwordIssuedAt as number)
    ) {
      return null  // invalidate session
    }
  }
  return token
},
```

Alternative (no schema change): set a shorter session `maxAge` (e.g. 1 hour) so stolen tokens expire quickly. Less precise but zero implementation cost.

---

#### No Rate Limiting on Any Auth Endpoint

**Severity**: High
**Files**: `src/app/api/auth/register/route.ts`, `src/app/api/auth/forgot-password/route.ts`, `src/app/api/auth/resend-verification/route.ts`, `src/actions/auth.ts`

**Problem**: There is no rate limiting on any authentication endpoint:

- `POST /api/auth/register` — unlimited account creation allows spam and free-tier exhaustion.
- `POST /api/auth/forgot-password` and `forgotPasswordAction` — unlimited reset emails to any address enables email bombing.
- `POST /api/auth/resend-verification` — same email bombing vector.
- `signInWithCredentials` (Server Action) — unlimited login attempts enable credential stuffing.

The `resendVerification` function in `src/lib/emails/verification.ts` does implement a 55-minute token-freshness window, which limits resend frequency per email. This is not request-level rate limiting: an attacker can still call the endpoint at high volume across many addresses without any throttle.

**Attack Scenario 1 (brute force)**: An attacker runs a credential-stuffing campaign against `signInWithCredentials`. With no lockout, they can test thousands of password combinations per minute.

**Attack Scenario 2 (email bombing)**: An attacker calls `POST /api/auth/forgot-password` in a loop with a victim's email. Each call deletes the existing token and creates a new one, triggering a new email every time.

**Fix**: Add rate limiting at the infrastructure or application layer. For a Vercel/Neon deployment, Upstash Redis with `@upstash/ratelimit` is a natural fit:

```typescript
// src/lib/rate-limit.ts
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

export const authRatelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, '10 m'), // 10 requests per 10 minutes per IP
})

// In forgot-password route:
export const POST = apiRoute(async (request) => {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const { success } = await authRatelimit.limit(ip)
  if (!success) return ApiResponse.TOO_MANY_REQUESTS('Too many requests. Please try again later.')
  // ...
})
```

For sign-in brute force, also add a per-email counter in addition to per-IP to prevent distributed attacks.

---

### Medium Severity

---

#### No Maximum Password Length (bcrypt DoS Vector)

**Severity**: Medium
**Files**: `src/actions/auth.ts` (lines 77, 139), `src/app/api/auth/register/route.ts` (line 22), `src/actions/profile.ts` (line 24)

**Vulnerable Code**:

```typescript
// src/actions/auth.ts — registerAction
if (password.length < 8) return ApiResponse.BAD_REQUEST('Password must be at least 8 characters.')
// No upper bound check

// src/actions/profile.ts — changePasswordAction
if (newPassword.length < 8) {
  return ApiResponse.BAD_REQUEST('New password must be at least 8 characters.')
}
// No upper bound check
```

**Problem**: bcrypt silently truncates input at 72 bytes. A password longer than 72 bytes has reduced effective entropy. More critically, there is no server-side cap, so an attacker can submit a multi-megabyte string to any endpoint calling `bcrypt.hash()`, causing the server to spend seconds on a single operation. A small number of concurrent requests can saturate the Node.js thread pool.

**Attack Scenario**: An attacker sends 1 MB passwords to `POST /api/auth/register` or `signInWithCredentials`. At bcrypt cost 12, this takes several seconds per call. A handful of concurrent requests can block all server threads.

**Fix**: Add a maximum length check before any bcrypt call:

```typescript
const MAX_PASSWORD_LENGTH = 128

if (password.length < 8) return ApiResponse.BAD_REQUEST('Password must be at least 8 characters.')
if (password.length > MAX_PASSWORD_LENGTH) return ApiResponse.BAD_REQUEST('Password must be at most 128 characters.')
```

Apply consistently in: `registerAction`, `resetPasswordAction`, `changePasswordAction`, `POST /api/auth/register/route.ts`.

---

#### Email Parameter Reflected in Redirect Without Validation

**Severity**: Medium
**File**: `src/actions/auth.ts`
**Lines**: 126-127, 167

**Vulnerable Code**:

```typescript
// forgotPasswordAction
redirect(`/forgot-password?sent=1&email=${encodeURIComponent(email)}`)

// registerAction
redirect(`/register?pending=1&email=${encodeURIComponent(email)}&sent=${verification === 'sent' ? '1' : '0'}`)
```

And in the consuming page (`src/app/(auth)/register/page.tsx`):

```tsx
We sent a verification link to{' '}
<span className="font-medium text-foreground">{email}</span>.
```

**Problem**: The raw form `email` value is placed into a redirect URL and then rendered from `searchParams`. JSX escaping prevents XSS, but an attacker can craft a shareable link like `/forgot-password?sent=1&email=your+account+was+compromised+click+here` and send it to a victim. The victim sees attacker-controlled text rendered in trusted UI. There is also no server-side email format validation before the redirect, so arbitrarily long strings are embedded in the URL.

**Fix**: Validate email format server-side before constructing the redirect. Also consider omitting the email from the URL entirely and using a generic confirmation message instead.

```typescript
// In registerAction and forgotPasswordAction, add before redirect:
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
if (!emailRegex.test(email)) return ApiResponse.BAD_REQUEST('Invalid email address.')
```

---

### Low Severity

---

#### `resend-verification` Endpoint Does Not Validate Email Type

**Severity**: Low
**File**: `src/app/api/auth/resend-verification/route.ts`
**Lines**: 8-10

**Vulnerable Code**:

```typescript
export const POST = apiRoute(async (request: NextRequest) => {
  const { email } = await request.json()
  if (!email) {
    return ApiResponse.BAD_REQUEST('Email is required')
  }
  await resendVerification(email)
  return ApiResponse.OK()
})
```

**Problem**: Only truthiness is checked — not that `email` is a string. A non-string value (object, array) passes and is forwarded to a Prisma `findUnique`, which throws. The `apiRoute` wrapper catches the error and returns a 500, but type validation should happen at the boundary.

**Fix**:

```typescript
if (!email || typeof email !== 'string') {
  return ApiResponse.BAD_REQUEST('Email is required')
}
```

---

#### `forgotPasswordAction` Missing Email Format Validation

**Severity**: Low
**File**: `src/actions/auth.ts`
**Lines**: 113-116

**Problem**: The API route counterpart (`/api/auth/forgot-password/route.ts`) checks `typeof email !== 'string'`, but the Server Action only checks for truthiness. A malformed input that passes the truthy check proceeds to a Prisma query and a `redirect()` that embeds the value in the URL.

**Fix**:

```typescript
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
if (!email || !emailRegex.test(email)) return ApiResponse.BAD_REQUEST('Email is required.')
```

---

#### `peekPasswordResetToken` TOCTOU Window

**Severity**: Low
**File**: `src/lib/tokens.ts`, `src/app/(auth)/reset-password/page.tsx`
**Lines (tokens)**: 32-44; **Lines (page)**: 22-23

**Problem**: Between the page render (which peeks the token to decide whether to show the form) and form submission (which consumes the token), the token remains in the database. This is low risk because `consumePasswordResetToken` is the authoritative gate. However, `peekPasswordResetToken` can delete an expired token without synchronization — a race between a peek (which deletes expired) and a concurrent consume (which also tries to delete) could surface a Prisma error if `delete` throws on not-found.

**Fix**: Change expired-token cleanup in `peekPasswordResetToken` to use `deleteMany` instead of `delete`:

```typescript
await prisma.verificationToken.deleteMany({ where: { token } })
```

---

### Previously Flagged — Confirmed False Positive

---

#### ~~Route Protection Middleware Not Active~~ — NOT AN ISSUE

**Original Severity**: ~~Critical~~
**File**: `src/proxy.ts`

The initial audit incorrectly flagged this as critical, citing that Next.js requires a file named `middleware.ts` with `export default`. This applied pre-v16 knowledge to a Next.js 16 project.

**Context7 Verification**: Next.js 16 renamed the middleware convention. `middleware.ts` → `proxy.ts` and the named export `middleware` → `proxy` are the correct v16 conventions. Both named export (`export const proxy = ...`) and default export are accepted. The codemod `npx @next/codemod@canary middleware-to-proxy .` performs exactly this migration. The current `src/proxy.ts` with `export const proxy = auth` is correct.

The empty `middleware-manifest.json` is from a stale build artifact, not a misconfiguration. The `authorized` callback in `auth.config.ts` that guards `/dashboard` and `/profile` is active and correctly configured.

---

## Passed Checks

The following security controls were correctly implemented and should be preserved:

- **Cryptographically secure token generation**: `randomBytes(32).toString('hex')` provides 256 bits of entropy. Both verification and password reset tokens use this correctly.
- **Single-use password reset tokens**: `consumePasswordResetToken` deletes the token before returning. There is no window where the same token can be used twice.
- **Single-use email verification tokens**: `verify-email/page.tsx` deletes the token atomically alongside the `emailVerified` update in a transaction.
- **Token type segregation**: Password reset tokens use the `password-reset:<email>` identifier prefix. The verification page explicitly rejects tokens with this prefix, preventing cross-contamination.
- **bcrypt cost factor**: `bcrypt.hash(password, 12)` is used consistently. Cost 12 is appropriate for current hardware.
- **Password not stored in JWT**: The JWT only contains `id` and standard claims. No password hash or sensitive fields are included.
- **User enumeration prevention at registration**: Both the API route and Server Action return the same response shape regardless of whether the email already exists.
- **User enumeration prevention at password reset**: Both the API route and Server Action return the same success message regardless of whether the email exists or has a password set.
- **Session validation on sensitive actions**: `changePasswordAction` and `deleteAccountAction` call `auth()` and check `session?.user?.id` before any DB operation. User ID is sourced from the session, never from client input.
- **Current password required for password change**: `changePasswordAction` verifies the existing password with `bcrypt.compare` before allowing an update.
- **OAuth account protection**: Password reset is blocked for OAuth-only accounts (no password set), returning a non-enumerating error.
- **JWT callback user existence check**: The `jwt` callback checks whether the user still exists in the database on every token refresh, invalidating sessions for deleted accounts.
- **No plaintext password logging**: No `console.log` or error message exposes a password value anywhere in the auth code.
- **Error messages do not leak stack traces**: The `apiRoute` wrapper catches all unhandled errors and returns a generic `internal_error` response.
- **Token expiry enforcement**: Both `peekPasswordResetToken` and `consumePasswordResetToken` check `record.expires < new Date()` and reject expired tokens.
- **Password reset TTL is 1 hour**: `PASSWORD_RESET_TTL_MS = 60 * 60 * 1000` is appropriately short.
- **Resend rate limiting (partial)**: `resendVerification` checks whether the existing token is within a 55-minute freshness window before issuing a new one.
- **Correct Next.js 16 proxy convention**: `src/proxy.ts` uses the correct v16 file name and `export const proxy` named export to protect `/dashboard` and `/profile`.

---

## Recommendations Summary

Ordered by impact:

1. **[High] Add rate limiting to all auth endpoints** — at minimum: sign-in (per-IP + per-email), forgot-password (per-IP + per-email), register (per-IP), resend-verification (per-IP). Consider Upstash Ratelimit for serverless compatibility.

2. **[High] Invalidate sessions after password reset** — add `passwordChangedAt` to the User model and compare against a `passwordIssuedAt` claim in the JWT callback. Both `resetPasswordAction` and the reset API route need to set this timestamp. Alternative: shorten session `maxAge` to limit stolen-token exposure window.

3. **[Medium] Cap maximum password length at 128 characters** — add `password.length > 128` checks everywhere `bcrypt.hash` is called to prevent the large-input DoS pattern.

4. **[Medium] Validate email format before reflecting in redirects** — add a simple regex check in `registerAction` and `forgotPasswordAction` before constructing the redirect URL.

5. **[Low] Add type validation to `resend-verification` endpoint** — check `typeof email !== 'string'`.

6. **[Low] Add email format validation to `forgotPasswordAction`** — align with the API route equivalent.
