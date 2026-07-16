# Legacy `src/` (Next.js + NextAuth v5) — stack context and do-not-flag list

Read this **only when auditing `src/`**. It is the false-positive guard for the legacy
Next.js app: the layers this codebase already has, and the controls NextAuth v5 provides
for free. Auditing without it produces findings for protections that already exist.

`src/` is maintenance-only (see `.agents/rules/boundary.md`). The Go backend does **not**
use any of this — see the note in SKILL.md.

## Project Stack Context (DevStash-specific — check these layers before flagging)

This codebase has dedicated security infrastructure. Grep and read it before reporting a missing control, or you will produce false positives:

- **Auth tokens live in Upstash Redis, not the DB** ([src/lib/auth/tokens.ts](src/lib/auth/tokens.ts)). Expiration is enforced by Redis TTL (`set(..., { ex })`), not a DB `expiresAt` column. Single-use is enforced atomically via `getdel` (GETDEL — value-and-delete in one round-trip). Tokens are stored as their SHA-256 hash, never raw. So: verify TTL is set and short, verify consume uses `getdel` (not get-then-delete, which races), and confirm raw tokens are never persisted — do **not** look for DB-row deletion that does not exist here.
- **Rate limiting is centralized** in [src/lib/infra/rate-limit.ts](src/lib/infra/rate-limit.ts) (`checkRateLimit`, `rateLimitAction`, `withRateLimit`). Before flagging "login/registration/reset not rate limited", grep each auth route/action ([src/app/api/auth/**/route.ts](src/app/api/auth/), [src/actions/auth/](src/actions/auth/)) for a call into this module. Only flag a route that genuinely lacks one.
- **Password hashing is `bcryptjs`** in [src/lib/auth/auth-service.ts](src/lib/auth/auth-service.ts), with a fixed dummy-hash compare on the no-user / OAuth-only branch to equalize login timing. Recognize that pattern as the *correct* mitigation for user-enumeration-via-timing — do not flag it as a redundant compare.

## What NextAuth v5 Handles Automatically (DO NOT FLAG)

- CSRF token validation
- Secure cookie flags (httpOnly, secure, sameSite)
- OAuth state parameter validation
- Session token generation and validation
- JWT signing and encryption (when using JWT strategy)
- Callback URL validation (when properly configured)
- Provider-level security (OAuth flows)

## Find Auth Files (legacy `src/` surface)

   ```
   Glob: src/auth.ts            (NextAuth config + authorize)
   Glob: src/auth.config.ts     (edge-safe config)
   Glob: src/actions/auth/**/*  (server actions: login, link)
   Glob: src/app/api/auth/**/*  (route handlers: register, reset, verify, ...)
   Glob: src/lib/auth/**/*      (tokens, auth-service)
   Glob: src/components/auth/**/*
   Grep: "credentials" in auth config
   Grep: "bcrypt|argon|hash|compare" for password handling
   Grep: "getdel|verification|reset|token" for token flows
   Grep: "checkRateLimit|rateLimitAction|withRateLimit" for rate-limit coverage
   ```
