# Feature: Auth Modals (sign-in / register / forgot-password over marketing)

## Status
Planned — not started. (Branch: `feature/auth-modals`. Does **not** touch the in-flight
`ai-usage-meter` work; `current-feature.md` stays pointed at that until this is promoted.)

## Summary
Show **sign-in**, **register**, and **forgot-password** as dialogs over the marketing homepage
instead of standalone pages. Per the product decision, there are **no route files** for these three
paths — the modal is driven entirely by a `?auth=` **search param** on `/` (shareable, refreshable,
and a valid NextAuth redirect target), with no `(.)`-intercepting route and no `(auth)/sign-in`,
`(auth)/register`, or `(auth)/forgot-password` page.

The four **token pages stay real pages** (they are opened from emails / OAuth and cannot be modals):
`reset-password`, `verify-email`, `link-account`, `confirm-login-email`. The `(auth)/layout.tsx`
shell stays for them.

## Mechanism
- **State = URL.** No Zustand store. The modal's open/which is derived from `useSearchParams()`:
  - `/?auth=sign-in` · `/?auth=register` · `/?auth=forgot` open the matching dialog.
  - A bare `?callbackUrl=…` (what NextAuth appends when it redirects an unauthenticated user) also
    opens the **sign-in** dialog. (`pages.signIn` cannot carry its own query reliably, so presence of
    `callbackUrl` is the implicit sign-in trigger.)
  - `?verified=1` / `?resent=1` alongside `auth=sign-in` pass `successMessage` into `SignInForm`
    (same strings the old `/sign-in` page computed).
- **Open** = `<Link href="/?auth=…" scroll={false}>` (or `router.push`). **Close** = strip the param
  (`router.replace('/', { scroll: false })` / `router.back()` when history allows).
- **Render** = a new client `AuthModalController` mounted in the marketing layout, using the existing
  `ResponsiveFormDialog` (centered Dialog on desktop, swipe `BottomSheet` on mobile — free) with the
  dynamic forms from `dynamic-forms.tsx` (still `ssr:false`, skeletons reused).
- **Cross-navigation between forms** (e.g. "Forgot password?", "Sign up", "Already have an account?")
  switches the `?auth=` param instead of navigating to a deleted route.

## Forms become self-contained (key change)
Today register/forgot success is a **server-driven page navigation**: the API returns a `redirectTo`
URL (`/register?pending=1&email=…&sent=1`, `/forgot-password?sent=1&email=…`) and the deleted page
re-renders a "check your email" card from query params. With those pages gone, the forms must render
their own success state in place (no navigation):
- `RegisterForm` → local `status` state; on success shows the **pending card** (verification-sent vs
  send-failed copy + `ResendVerificationButton` + "Go to sign in" → `?auth=sign-in`). JSX moves from
  the old `register/page.tsx` pending branch.
- `ForgotPasswordForm` → local `sent` state; on success shows the **"Check your email"** card
  ("Try a different email" resets the form; "Back to sign in" → `?auth=sign-in`). JSX moves from the
  old `forgot-password/page.tsx` sent branch.
- `SignInForm` → unchanged logic, but post-login pushes `callbackUrl ?? '/dashboard'`, and its
  internal links ("Forgot password?", "Sign up") switch the `?auth=` param.

### API response contract
The register/forgot routes currently return a `redirectTo` **string** that encodes state in the URL.
Forms now need the state as data, so change those two responses to **structured fields** (cleaner
than parsing a URL client-side):
- `POST /auth/register` → `{ status: 'pending' | 'signin', email: string, emailSent: boolean }`
  (replaces `redirectTo`). `signin` = verification skipped (dev kill-switch) → form switches to
  `?auth=sign-in`.
- `POST /auth/forgot-password` → `{ sent: true, email: string }` (replaces `redirectTo`).
- Update `schemas/auth.ts`, `openapi/paths.ts`, run `npm run openapi:gen`, and update the
  `auth.test.ts` assertions (currently assert `redirectTo === '/sign-in'` etc.).

## File inventory

### Delete
- `src/app/(auth)/sign-in/page.tsx`
- `src/app/(auth)/register/page.tsx`
- `src/app/(auth)/forgot-password/page.tsx`

### Create
- `src/components/auth/auth-modal-controller.tsx` — `'use client'`; reads `useSearchParams`, renders
  `ResponsiveFormDialog` + the matching dynamic form; owns title/description per mode and the
  `verified`/`resent` → `successMessage` mapping; close strips the param.

### Modify — redirect targets (`/sign-in` → `/?auth=sign-in`)
- `src/auth.config.ts` — `pages.signIn: '/'` (controller auto-opens on `callbackUrl`).
- Protected-route server redirects: `src/app/(app)/layout.tsx`, `(app)/settings/page.tsx`,
  `(app)/dashboard/page.tsx`, `(app)/profile/page.tsx`, `(app)/upgrade/page.tsx`.
- `src/actions/auth/link.ts` (`redirect('/sign-in')`).
- `src/app/api/billing/checkout-return/route.ts` (builds a `/sign-in` URL).
- Real token pages' "go to sign in" CTAs: `(auth)/verify-email/page.tsx`,
  `(auth)/link-account/page.tsx`, `(auth)/reset-password/page.tsx` ("Request new link" →
  `?auth=forgot`), `components/auth/auth-page-header.tsx` (`DEFAULT_ACTION`),
  `components/auth/confirm-email-change-form.tsx`, `components/auth/token-password-form.tsx`,
  `components/auth/resend-verification-button.tsx` (`/sign-in?resent=1` → `/?auth=sign-in&resent=1`).

### Modify — marketing CTAs (`/register` → `/?auth=register`, `/sign-in` → `/?auth=sign-in`)
- `src/components/marketing/homepage-nav.tsx` (3 links).
- `src/app/(marketing)/page.tsx` (`GradientCta` ×2 — the code-sample literal on line ~331 is display
  text, leave it).
- `src/components/marketing/pricing-section-interactive.tsx` (2 `/register` hrefs).
- `src/app/(marketing)/layout.tsx` — mount `<AuthModalController />` inside the providers shell.

### Modify — forms (self-contained success + param cross-links)
- `src/components/auth/sign-in-form.tsx`, `register-form.tsx`, `forgot-password-form.tsx`.

### Modify — API contract
- `src/app/api/auth/register/route.ts`, `src/app/api/auth/forgot-password/route.ts`,
  `src/lib/api/schemas/auth.ts`, `src/lib/api/openapi/paths.ts`, then regen `openapi.json` +
  `src/types/openapi.ts` via `npm run openapi:gen`.

## Constraints
- No route files for the three modal paths; no intercepting/parallel routes (the param drives it).
- `userId`/session handling unchanged; OAuth server actions (`signInWithGitHub/Google`) unchanged —
  they hard-redirect out and back, landing on `callbackUrl`/`/dashboard`.
- Reuse `ResponsiveFormDialog`, `dynamic-forms`, `ResendVerificationButton`; do not re-skin.
- Forms stay `'use client'` + `ssr:false`; keep `suppressHydrationWarning`.
- Token pages and `(auth)/layout.tsx` are untouched except their "back to sign in" hrefs.

## Out of scope
- Intercepting/parallel-route variant (rejected in favor of param-only, no route files).
- Converting token pages (`reset-password`/`verify-email`/`link-account`/`confirm-login-email`) to
  modals — they must stay real URLs.
- Any change to auth logic, rate limiting, or the OAuth providers.

## Tests (per testing rule — server/route/util only, no component tests)
- `src/app/api/auth/auth.test.ts` — update register/forgot assertions to the new structured
  responses.
- `src/app/api/billing/checkout-return/route.test.ts` — update `/sign-in` → `/?auth=sign-in`.
- `src/actions/auth/link.test.ts` — update the `REDIRECT:/sign-in` expectation.
- Modal controller / forms: no unit tests (components) — verify via Playwright.

## Verification
- `npm run lint` + `npm run test:run` (touches API routes + actions).
- `npm run build` (route deletions + `pages.signIn` change touch routing/middleware).
- Playwright UI walkthrough: open each modal from the nav/CTAs, switch between them, submit
  register (pending card) + forgot (check-email card), confirm a protected-route hit redirects to
  `/?...` with the sign-in modal open, refresh-on-`?auth=` re-opens, and OAuth round-trips land on
  `callbackUrl`.
