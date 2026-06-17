# Feature: Separate, verified credential-login email

## Status
In Progress

## Problem
A user who signed up via OAuth can only set a credential (email + password) login on an email they
already own — their OAuth/primary `User.email` or a linked `Account.email`. The in-app **Set
password** flow rejects any other address with *"You can only use an email from one of your linked
accounts."* The user wants to create a credential login on an arbitrary email they did **not** sign
up with, while keeping the original OAuth identity email intact.

## Why the restriction exists (do not naively remove)
`POST /api/profile/password` → `setInitialUserPassword` sets the password **and** marks
`emailVerified` immediately. That auto-verify is only safe because the chosen email was already
proven owned (OAuth/linked). Allowing an arbitrary email there would mark an unproven address as
verified → email-verification bypass / impersonation. So we do **not** loosen that endpoint.

## Decisions
1. **Verify-then-activate** — allow any email, but send a confirmation link to it; the credential
   login activates only after the link is clicked. No instant verification of an unproven email.
2. **Separate login email** — store a new `credentialEmail` distinct from the OAuth `User.email`.
   The OAuth identity email is never changed.
3. **Password is chosen on the confirmation page** (reuses the reset-password UX). Nothing is stored
   until ownership is proven by clicking the link.

## Design

### Schema (`User`)
- `credentialEmail String? @unique` — the login email, distinct from `email`.
- `credentialEmailVerified DateTime?` — set only when the confirmation link is consumed.

**Model trade-off (Gap E):** a single `credentialEmail` field is the lightweight choice for the
current "one extra login email" scope. The scalable identity pattern (GitHub-style) is a dedicated
`UserEmail` table — one row per address with a `verified` flag, login via any verified email. We
deliberately defer that; if "multiple login emails" is ever requested, migrate to `UserEmail` rather
than adding more `credentialEmail2`-style columns.

### Login resolution
- `getUserAuthInfoByEmail` resolves by `User.email == input OR User.credentialEmail == input`, and
  reports which field matched + the matching verified timestamp.
- `auth.ts` `authorize` gates on the relevant verified timestamp: matched-by-`email` →
  `emailVerified`; matched-by-`credentialEmail` → `credentialEmailVerified`.

### Resolution-path consistency (Gap B)
A `credentialEmail` the user can log in with must behave consistently everywhere an address is
resolved — otherwise login works but recovery/conflict-detection silently doesn't. Update **all**
ownership-resolution paths to also match `credentialEmail` (verified only):
- `findUserByAnyEmail` (forgot-password / register-over-existing) → so password recovery reaches the
  account via its `credentialEmail`, and the reset link still targets a proven inbox.
- `getUserWithOAuthConflict` → so a later OAuth sign-up with that address is detected as a conflict
  (pending-link flow) instead of creating a duplicate user.
- Match on `credentialEmail` **only when `credentialEmailVerified` is set** — an unconfirmed pending
  address must never participate in resolution.

### Cross-column uniqueness + race safety (Gap A)
`credentialEmail String? @unique` only prevents two rows sharing a `credentialEmail`; it does **not**
stop a `credentialEmail` from colliding with another user's `email`. So:
- The app-level pre-check (email not used as any `email` or `credentialEmail`) is necessary but
  insufficient — two concurrent confirms are a TOCTOU race.
- **Authoritative guard:** run the final existence check + write inside one transaction, and treat a
  unique-constraint violation (`P2002`) at write time as "email already in use" (return 409). DB
  constraint is the source of truth; the pre-check is only UX.

### Token flow (reuse `VerificationToken`, new identifier prefix `credential-email:<userId>:<email>`)
- **Request** — `POST /api/profile/credential-email` (authed, rate-limited): reject an email already
  used by any user's `email` or `credentialEmail`; create token; email the confirmation link to
  **that** address. Always resolves without leaking existence.
- **Confirm** — `/confirm-login-email?token=…` page collects the password; `POST
  /api/auth/confirm-login-email` (public, token-gated): consume token → set `password` +
  `credentialEmail` + `credentialEmailVerified` (transactional per Gap A). After success, notify the
  account owner (Gap C).

### Owner notification (Gap C)
Adding a new login email is security-sensitive. On successful confirm, fire `sendSecurityNotification`
to the account's primary `email` (not the new address) — mirrors the existing password-set/changed
notifications. Add a `credential-email-added` notification variant.

### Session-fingerprint interaction (Gap D)
Confirm sets `password`, changing the `pwHash` fingerprint in the `auth.ts` `jwt` callback. The
existing logic treats "password added (was empty)" as a non-invalidating sync, so an OAuth-only
user's live session survives. This is the intended behavior — assert it in tests so it can't
regress into a forced logout.

### Email
- New sender + template under `src/lib/emails/` (clone of `password-reset`).

### UI
- Profile **Set password** dialog gains the ability to request a credential-login email (entering an
  email not owned); copy explains a verification link will be sent (no instant activation).

## Best-practice alignment (Auth.js, via Context7)
- **Email-ownership-before-linking** mirrors Auth.js refusing to auto-link by email without
  `allowDangerousEmailAccountLinking` (`OAuthAccountNotLinked`) — verify-then-activate is the same
  boundary applied to credential emails.
- **Credentials hardening** (Zod-validated `authorize`, bcrypt salt+hash, `strategy: "jwt"`) is
  already in place and unchanged.
- **VerificationToken** reuse with an `identifier` prefix is the canonical Auth.js token pattern;
  tokens stay single-use, TTL-bounded, hashed-at-rest.
- **Enumeration safety + rate limiting** on the request endpoint match the existing recovery flows.

## Files
- `prisma/schema.prisma` (+ migration)
- `src/lib/db/users.ts` (resolution paths — Gap B), `src/auth.ts` (authorize gating)
- `src/lib/db/tokens.ts`, `src/lib/auth/tokens.ts`, `src/lib/auth/auth-service.ts` (transactional
  confirm + owner notification — Gaps A, C)
- `src/lib/emails/credential-email.ts` + `.html`; `credential-email-added` security-notification variant
- `src/app/api/profile/credential-email/route.ts`, `src/app/api/auth/confirm-login-email/route.ts`
- `src/lib/api/schemas/profile.ts` / `auth.ts` + `src/lib/api/openapi/paths.ts`
- `src/app/(auth)/confirm-login-email/page.tsx` + form, profile dialog UI
- Tests: `src/lib/auth/auth-service.test.ts` (request, confirm, resolution paths, session-survives — Gap D)

## Out of scope
- Letting a user have multiple credential emails (single `credentialEmail` only; see `UserEmail`
  trade-off under Schema).
- Changing the existing owned-email instant Set-password path.
</content>
</invoke>
