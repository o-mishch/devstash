---
description: Security rules for DevStash — IDOR prevention, auth patterns, input validation, token handling. Loaded when working with auth, API, actions, or database files.
paths:
  - "src/app/api/**"
  - "src/actions/**"
  - "src/auth.ts"
  - "src/auth.config.ts"
  - "src/lib/auth-service.ts"
  - "src/lib/tokens.ts"
  - "src/lib/rate-limit.ts"
  - "src/lib/db/**"
  - "prisma/**"
---

# Security Rules

## IDOR Prevention (Critical)

Every Prisma query that reads or modifies user data **must** scope by `userId` from the authenticated session — never from user-supplied input (request body, query params, route segments).

```ts
// ✅ correct — userId from session
const items = await prisma.item.findMany({ where: { userId: session.user.id } })

// ❌ wrong — userId from user input
const items = await prisma.item.findMany({ where: { userId: params.userId } })
```

## Auth in Server Actions

Every server action touching user data must verify the session first:

```ts
const session = await auth()
if (!session?.user?.id) return ApiResponse.UNAUTHORIZED()
```

## Input Validation

All external inputs (form data, query params, JSON bodies) must be parsed with Zod before use. Never trust raw request data.

## Token Security

- Generate tokens with `generateSecureToken()` from `src/lib/tokens.ts` (32-byte hex via `crypto.randomBytes`) — never `Math.random()`
- Tokens must be **single-use** — delete from DB immediately after consumption
- Enforce expiry server-side before accepting a token

## Password Handling

- Hash with `bcryptjs` cost 12 via `src/lib/auth-service.ts`
- Never log, store, or return password hashes to the client
- Always verify current password before allowing password change

## Rate Limiting

New auth-adjacent endpoints must apply rate limiting via `src/lib/rate-limit.ts`. Existing limits: login (5/15min per IP+email), register/forgot-password (3/1h per IP), reset-password (5/15min per IP).

## What NextAuth Handles (Do Not Re-implement)

CSRF, session token generation/validation, secure cookie flags, OAuth state validation, callback URL validation.

## Patterns That Are Always Wrong

- `prisma.*.findMany({})` with no `userId` filter → IDOR
- `request.json()` without Zod parse → unvalidated input
- `Math.random()` for token/secret generation → weak entropy
- `fetch()` from client components → bypasses `apiFetch` contract
- Returning stack traces or internal error details to the client
