---
trigger: glob
globs:
  - src/app/api/**/*
  - src/actions/**/*
  - src/auth.ts
  - src/auth.config.ts
  - src/lib/auth/**/*
  - src/lib/infra/rate-limit.ts
  - src/lib/db/**/*
  - prisma/**/*
paths:
  - "src/app/api/**/*"
  - "src/actions/**/*"
  - "src/auth.ts"
  - "src/auth.config.ts"
  - "src/lib/auth/**/*"
  - "src/lib/infra/rate-limit.ts"
  - "src/lib/db/**/*"
  - "prisma/**/*"
description: Security rules for DevStash — IDOR prevention, auth patterns, input validation, token handling. Loads when editing API routes, server actions, auth, or database files.
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
if (!session?.user?.id) return { success: false, message: 'Unauthorized' }
```

## Input Validation

All external inputs (form data, query params, JSON bodies) must be parsed with Zod before use. Never trust raw request data.

## Token Security

- Generate tokens with `generateSecureToken()` from `src/lib/auth/tokens.ts` (32-byte hex via `crypto.randomBytes`) — never `Math.random()`
- Auth tokens live in Upstash Redis, **hashed at rest** (the SHA-256 of the raw token is the key) — never store the raw token
- Tokens must be **single-use** — consume atomically with Redis `getdel` (returns the value and deletes in one round-trip), never read-then-delete
- Enforce expiry server-side — set a TTL (`ex`) at issue time; an expired key simply returns null

## Password Handling

- Hash with `bcryptjs` cost 12 via `src/lib/auth/auth-service.ts`
- Never log, store, or return password hashes to the client
- Always verify current password before allowing password change

## Rate Limiting

New auth-adjacent endpoints must apply rate limiting via `src/lib/infra/rate-limit.ts` — add a keyed entry to its config (each entry documents its window and key inline) rather than hardcoding limits at the call site. Keys are bucketed by IP, IP+email, or userId depending on whether the caller is authenticated.

## Dev Email Kill Switch (`DISABLE_EMAIL_VERIFICATION`)

When `DISABLE_EMAIL_VERIFICATION=true` (local dev / staging):

- **Never send outbound email** — verification links, password resets, credential-email links, security notifications, and billing emails must all no-op.
- The single enforcement point is `sendEmail()` in `src/lib/infra/resend.ts` (returns `'skipped'` without calling Resend, logging the skip — never `'sent'`, so telemetry stays honest). **Never** call the Resend SDK directly — all senders funnel through `sendEmail`.
- Verification **gates** (register auto-verify, login/authorize skip unverified check, instant credential-email activation) use `outboundEmailEnabled()` from `src/lib/utils/auth.ts` — the single source for this flag.
- Do not add per-sender bypasses for security or billing emails when the flag is set.

## What NextAuth Handles (Do Not Re-implement)

CSRF, session token generation/validation, secure cookie flags, OAuth state validation, callback URL validation.

## Patterns That Are Always Wrong

- `prisma.*.findMany({})` with no `userId` filter → IDOR
- `request.json()` without Zod parse → unvalidated input
- `Math.random()` for token/secret generation → weak entropy
- Calling our API from a client component with anything other than `api` / `$api` (`@/lib/api/client`, backed by `openapi-fetch` / `openapi-react-query`) → bypasses the typed contract
- Returning stack traces or internal error details to the client
