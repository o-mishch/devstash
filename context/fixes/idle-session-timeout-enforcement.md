# Fix Idle Session Timeout Not Enforced

## Problem

The "Auth Hardening" feature (see `context/history.md`) shipped a **30-minute idle session
timeout**, but it never logs anyone out. Users who walk away for hours stay signed in; the
intended force-logout on inactivity does not happen.

## Root Cause

The idle check is wired into the wrong NextAuth instance — one that cannot act on it.

There are two NextAuth instances in the app:

| Instance | Built from | Has idle `jwt` callback? | Runs where |
|---|---|---|---|
| `src/auth.ts` (Node) | `authConfig` + full callbacks | ✅ yes (`applySessionActivity`) | Server Components, route handlers, server actions |
| `src/proxy.ts` (proxy/“middleware”) | `authConfig` **only** | ❌ no | every protected-route navigation |

- `src/proxy.ts` is what actually **gates** protected routes (`/dashboard`, `/items`, …) via the
  `authorized` callback in `src/auth.config.ts`. But `authConfig` has **no `jwt` callback at all**,
  so the proxy never reads `lastActiveAt` and never invalidates an idle session. While the raw JWT
  is within its 24h `maxAge`, the proxy keeps admitting the user and rolls the cookie expiry forward.
  The 30-minute window is never checked at the gate.
- The only place the idle check runs is `auth()` in `src/auth.ts`, invoked from **Server Components**
  (e.g. `src/app/(app)/layout.tsx` → `getCachedSession()`). A Server Component **cannot write
  `Set-Cookie`**, so even when the callback returns `null`, the session cookie is never cleared and
  the next request sails through the proxy again.

Net: there is no enforcement point that can both *detect* the idle window and *act* on it.

### Why tests passed

`src/lib/auth/session-idle.test.ts` only exercises the pure `applySessionActivity` function (and a
local copy of the jwt logic). The function is correct in isolation; there is no test proving the
callback runs at the route gate — which is exactly where it is missing.

## Next.js 16 context (verified via Context7)

- `src/proxy.ts` is the **correct** Next.js 16 convention — `middleware.ts` was renamed to
  `proxy.ts` (export `proxy`, not `middleware`). Do **not** rename it back.
- In Next.js 16 the proxy runs on the **Node.js runtime** (Edge is not supported in `proxy`). So the
  idle check has **no Edge constraint** — it can run in the proxy without issue. (`applySessionActivity`
  is pure `Date` math anyway: no DB, no bcrypt.)

## Solution

Add the idle `jwt` callback to the edge/proxy config (`src/auth.config.ts`) so the proxy enforces
the window — it can both invalidate the token (→ `authorized` redirects to `/sign-in`) and write the
cleared cookie. `src/auth.ts` keeps its own richer `jwt` (DB + password-fingerprint checks), so the
Node instance is unchanged.

## Changes Required

### 1. `src/auth.config.ts`

- Import the idle helper and the user types:
  ```ts
  import { applySessionActivity } from '@/lib/auth/session-idle'
  import type { User } from 'next-auth'
  import type { AdapterUser } from 'next-auth/adapters'
  ```
- Add a typed params interface next to `AuthorizedParams`:
  ```ts
  interface JwtParams {
    token: JWT
    user?: User | AdapterUser
  }
  ```
- Add `jwt` as the first entry in `callbacks` (before `authorized`):
  ```ts
  jwt({ token, user }: JwtParams): JWT | null {
    const activity = applySessionActivity(token, Boolean(user))
    if (!activity) return null
    token.lastActiveAt = activity.lastActiveAt
    return token
  },
  ```
  Comment it: this runs in the proxy (the route gate); `auth.ts` overrides `jwt` with its richer
  DB-backed version, so this edge copy only affects the proxy instance.

### 2. `src/lib/auth/session-idle.test.ts`

- Add a case asserting the proxy/edge `jwt` path returns `null` (invalidates) when the idle window
  has elapsed, and refreshes `lastActiveAt` within it — mirroring the `authConfig.jwt` wiring, not
  just the bare function, so this gap can't silently reappear.

## Resulting Behavior

- Proxy `jwt` runs on every matched request. If `now - lastActiveAt > 30min` → returns `null` →
  empty session → `authorized` redirects protected routes to `/sign-in` **and** the proxy clears the
  session cookie.
- Within the window: `lastActiveAt` refreshes (navigation = activity) and the cookie rolls forward
  as before.
- `src/auth.ts` jwt is untouched (still calls `applySessionActivity` + DB/password checks).

## Out of Scope

- "No interaction with the tab open" idle detection (mouse/keyboard) — that needs a client-side ping
  and is a larger change. This fix uses the standard "idle = no navigation/request" model.
- Consolidating the `auth.config.ts` (edge) / `auth.ts` (node) split. It is now technically possible
  since the proxy runs on Node, but it is a separate refactor.

## Verification

- `npm run lint`
- `npm run test:run` (the new idle/proxy gate case + existing `session-idle` tests)
- Manual: sign in, wait past 30 min with no navigation, then load a protected route → redirected to
  `/sign-in`.
