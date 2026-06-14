# Mobile API Authentication

## Overview

Enable native mobile clients to authenticate with the existing DevStash REST API using Bearer token auth. NextAuth v5's `getToken()` already reads from `Authorization: Bearer <token>` natively — no changes to existing route handlers required. The feature adds a token issuance endpoint and a token refresh endpoint on top of the existing JWT session infrastructure.

## Background

The web app uses `next-auth.session-token` — a cookie sent automatically by the browser. Mobile apps cannot rely on cookie management, so the raw encrypted JWT must be issued explicitly and sent via `Authorization: Bearer` header on every request.

NextAuth `getToken()` source already handles this:
```typescript
if (!token && authorizationHeader?.split(" ")[0] === "Bearer") {
  const urlEncodedToken = authorizationHeader.split(" ")[1]
  token = decodeURIComponent(urlEncodedToken)
}
```

Existing `auth()` and `apiRoute()` wrappers pick up Bearer tokens without modification.

## Goals

- `POST /api/mobile/token` — credentials login; returns raw JWT + expiry
- `POST /api/mobile/token/refresh` — exchanges a valid (non-expired) token for a new one with a fresh expiry
- Mobile token TTL is longer than web session (configurable constant, default 30 days)
- All existing API routes work with Bearer tokens out of the box (no per-route changes)
- Parallel read routes mirror the SSR `src/lib/db/*` reads so mobile/CLI clients can fetch the same data the web app renders server-side (see [Parallel Read Routes](#parallel-read-routes-ssr--rest-mirror))
- OAuth sign-in (GitHub, Google) is out of scope — credentials only for V1

## Non-Goals

- OAuth flow for mobile (separate future spec)
- Push notifications, device registration
- Per-device token revocation (stretch goal — see Notes)

## API Contract

### `POST /api/mobile/token`

**Request body:**
```json
{ "email": "user@example.com", "password": "secret" }
```

**Response `200 ok`:**
```json
{
  "status": "ok",
  "data": { "token": "<raw-jwt>", "expiresAt": 1234567890 },
  "message": null
}
```

**Errors:** `401 unauthorized` (bad credentials / unverified email), `429 too_many_requests` (rate limited)

### `POST /api/mobile/token/refresh`

**Request:** `Authorization: Bearer <current-token>` header (no body)

**Response `200 ok`:**
```json
{
  "status": "ok",
  "data": { "token": "<new-raw-jwt>", "expiresAt": 1234567890 },
  "message": null
}
```

**Errors:** `401 unauthorized` (token expired or invalid), `429 too_many_requests`

## Implementation Plan

### 1. Constants — `src/auth.ts`

```typescript
export const MOBILE_TOKEN_MAX_AGE = 30 * 24 * 60 * 60  // 30 days
```

### 2. Token issuance helper — `src/lib/auth/mobile-token.ts`

```typescript
'server-only'
import { encode } from '@auth/core/jwt'
import { MOBILE_TOKEN_MAX_AGE } from '@/auth'

interface MobileTokenPayload {
  token: string
  expiresAt: number  // Unix seconds
}

export async function issueMobileToken(userId: string): Promise<MobileTokenPayload>
```

- Calls NextAuth `encode()` with `maxAge: MOBILE_TOKEN_MAX_AGE`
- Payload mirrors the JWT callback output (`id`, `pwHash`, etc.)
- Returns `{ token, expiresAt }`

### 3. `POST /api/mobile/token` — `src/app/api/mobile/token/route.ts`

- Parse + validate `{ email, password }` with Zod
- Rate limit: 5 attempts / 15 min per IP+email (reuse existing `rateLimitRoute` key `'login'`)
- Call `validateUserPassword()` from `src/lib/auth/auth-service.ts`
- Check `emailVerificationEnabled() && !user.emailVerified` → `401`
- Call `issueMobileToken(user.id)` and return `ApiResponse.OK({ token, expiresAt })`

### 4. `POST /api/mobile/token/refresh` — `src/app/api/mobile/token/refresh/route.ts`

- Extract Bearer token from `Authorization` header
- Call `getToken({ req, secret: AUTH_SECRET })` to decode and validate — returns `null` if expired or invalid
- Issue new token via `issueMobileToken(token.id)`
- Return `ApiResponse.OK({ token, expiresAt })`

### 5. Types — `src/types/mobile-auth.ts`

```typescript
export interface MobileTokenData {
  token: string
  expiresAt: number
}
```

## Files to Create / Modify

| Action | File |
|--------|------|
| Create | `src/app/api/mobile/token/route.ts` |
| Create | `src/app/api/mobile/token/refresh/route.ts` |
| Create | `src/lib/auth/mobile-token.ts` |
| Create | `src/types/mobile-auth.ts` |
| Modify | `src/auth.ts` — add `MOBILE_TOKEN_MAX_AGE` constant |

## Parallel Read Routes (SSR → REST mirror)

The web app's server components fetch directly via `src/lib/db/*` helpers — this is the correct RSC pattern and **stays unchanged**. Mobile/CLI clients have no React Server Component layer, so they need those same reads exposed as Bearer-authenticated REST routes.

**Principle:** each route **wraps the identical `src/lib/db/*` helper the SSR page already calls** — no new query logic, no inline `prisma.*` in the route. Every route uses `authenticatedRoute`, scopes to `userId` from the (Bearer) session — never from request input — and returns `ApiBody<T>`. All are `GET`, read-only.

### Already exposed by the server-action → REST migration — reuse, do NOT duplicate

| Read (`src/lib/db/*`) | Existing route |
|---|---|
| `getRecentItemsPage` / `getItemsByTypePage` / `getItemsByCollectionPage` / `getFavoriteItemsPage` | `GET /api/items` — discriminated `type` param (`recent`\|`type`\|`collection`\|`favorites`) + `cursor` |
| `getAllCollections` | `GET /api/collections` |
| `globalSearch` | `GET /api/search?q=` |
| item details / raw content | `GET /api/items/[id]/details`, `GET /api/items/[id]/content` |

### New read routes to add

| Route | Wraps (`src/lib/db/*`, server-only) | SSR page today | Response |
|---|---|---|---|
| `GET /api/collections/[id]` | `getCollectionById` | `collections/[id]` | `ApiBody<CollectionWithTypes>` — `404 not_found` if not owned by `userId`. Collection's items stay on `GET /api/items?type=collection&collectionId=…`. |
| `GET /api/dashboard` | `getItemStats`, `getCollectionStats`, `getCollectionsPreview`, `getPinnedItems` | `dashboard` | `ApiBody<DashboardOverview>` — one aggregate payload (stats + collection preview + pinned). Recent items stay on `GET /api/items?type=recent`. |
| `GET /api/favorites` | `getFavoriteCollections`, `getFavoriteItemTypeCounts` | `favorites` | `ApiBody<FavoritesOverview>` — favorite collections + per-type counts. Favorite items stay on `GET /api/items?type=favorites`. |
| `GET /api/profile` | `getProfileData`, `getProfileAccountSummary` | `profile` | `ApiBody<ProfileOverview>` — profile + connected-account summary. |
| `GET /api/profile/editor-preferences` | `getEditorPreferences` | `settings` | `ApiBody<EditorPreferences>` — `PATCH` on this path already exists from the migration; add the `GET` sibling. |
| `GET /api/billing/overview` | `loadBillingPageContext` | `upgrade`, `settings` | `ApiBody<BillingOverview>` — plan, pricing, subscription state. |
| `GET /api/app/bootstrap` | `loadAppSidebarData` + `getCachedVerifiedProAccess` + `canCreateItem` / `canCreateCollection` | `(app)/layout` | `ApiBody<AppBootstrap>` — sidebar data, Pro flag, usage caps. One call on app launch, mirrors the layout's server-side bundle. |

### Notes

- `getItemTypeBySlug` (used by `items/[type]`) is a trivial slug→type lookup over the immutable system types — **no route**; mobile derives types from the static constants in `src/lib/utils/constants.ts`.
- The **aggregate** routes (`/dashboard`, `/profile`, `/app/bootstrap`) deliberately collapse several `src/lib/db` reads into a single `ApiBody` payload to minimize mobile round-trips. Define a named interface per aggregate (no inline object types) in `src/types/*`.
- Reads are not auth-adjacent, so no per-route rate limiting beyond Bearer auth resolution — unlike the token issuance/login endpoints.
- **Writes are out of scope here** — `POST`/`PATCH`/`DELETE` for items, collections, profile, and billing already exist from the server-action → REST migration and work with Bearer tokens unchanged. This section is reads only.

### Files to Create

| Action | File |
|--------|------|
| Create | `src/app/api/collections/[id]/route.ts` — add `GET` (file already exists with `PATCH`/`DELETE`) |
| Create | `src/app/api/dashboard/route.ts` |
| Create | `src/app/api/favorites/route.ts` |
| Create | `src/app/api/profile/route.ts` — add `GET` (file already exists with `DELETE`) |
| Create | `src/app/api/profile/editor-preferences/route.ts` — add `GET` (file already exists with `PATCH`) |
| Create | `src/app/api/billing/overview/route.ts` |
| Create | `src/app/api/app/bootstrap/route.ts` |
| Create | `src/types/mobile-reads.ts` — `DashboardOverview`, `FavoritesOverview`, `ProfileOverview`, `BillingOverview`, `AppBootstrap` interfaces |

## Security

- Rate limit the token endpoint identically to `POST /api/auth/login` (5/15 min per IP+email)
- Tokens are signed + encrypted by NextAuth's `encode()` — same security as web session cookies
- Password fingerprint (`pwHash`) is embedded in the JWT payload — password rotation invalidates mobile tokens automatically (same mechanism as web)
- User deletion is caught by the `jwt()` callback DB check on each `auth()` call
- Do not log or return raw tokens beyond the issuance response

## Notes

- **Per-device revocation** (stretch): store issued token JTIs in Redis with `SADD mobile_tokens:{userId}` and check membership in the `jwt()` callback. Revoke all by `DEL mobile_tokens:{userId}`.
- **Token storage on device**: recommend iOS Keychain / Android Keystore via `expo-secure-store` or equivalent. Never `AsyncStorage`.
- **Web session TTL vs mobile TTL**: web uses `SESSION_MAX_AGE = 1 day`; mobile uses `MOBILE_TOKEN_MAX_AGE = 30 days`. Both constants live in `src/auth.ts`.
