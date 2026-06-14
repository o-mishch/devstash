# Signed URL Server-Side Redis Cache

## Overview

Cache signed R2 download URLs in Redis so that repeated calls to `GET /api/download/[id]/url` within the TTL window return the **same URL** (same HMAC signature). This makes the browser's `Cache-Control: max-age=840, private` header effective — the browser can only use its disk cache when the URL is stable across requests.

**Root cause of the current problem:**

`getSignedDownloadUrl` generates a fresh HMAC signature on every call. The signature includes the timestamp, so every call to `/api/download/[id]/url` returns a different URL for the same object. The browser sees a different URL on every page load and treats every fetch as a cache miss, re-downloading the same bytes even though the object hasn't changed.

```
Request 1 → /api/download/[id]/url → https://r2.../key?X-Amz-Signature=abc123&Expires=T+900
Request 2 → /api/download/[id]/url → https://r2.../key?X-Amz-Signature=xyz789&Expires=T+900
                                                              ↑ different every time
```

This spec is **complementary** to the client-side localStorage approach in `signed-url-cache-optimization-spec.md`:

| Layer | What it fixes |
|---|---|
| **Server Redis cache** (this spec) | Same URL returned for all callers (any browser, any session, any device) within the TTL window |
| **Client localStorage cache** | Eliminates the API round-trip entirely on page refresh within the same browser |

With both in place: stable URLs across all clients → browser disk cache works → no API call on refresh.

---

## Solution

On `GET /api/download/[id]/url`, check Redis for a cached `{ url, expiresAt }` before generating a new signed URL. On a cache miss, generate, store in Redis with `ex = SIGNED_URL_TTL_SECONDS - 120`, and return. On a cache hit, return the stored value directly — including the stored `expiresAt`, which reflects the actual URL expiry (not `now + 900s`).

```
Request 1 → Redis miss → generate URL (sig=abc123, expiresAt=T+900) → store in Redis → return
Request 2 → Redis hit  → return same URL (sig=abc123) + accurate expiresAt

Browser sees same URL both times → max-age=840 cache hit → no re-download
```

### TTL buffer

Redis entry TTL = `SIGNED_URL_TTL_SECONDS - 120` = **780 s**.

- The signed URL is valid for 900 s from generation.
- The Redis entry expires at 780 s — 120 s before the URL itself becomes invalid.
- This ensures we never serve a URL that is about to expire. The 120 s buffer (~13% of TTL) is a standard margin for this pattern.

### `expiresAt` accuracy

The `expiresAt` timestamp must be stored alongside the URL in Redis. Returning `getSignedUrlExpiresAt()` (= `now + 900s`) on a cache hit is **wrong** — a URL generated 500 s ago expires in 400 s, not 900 s. The Upstash TypeScript client auto-serializes JSON objects, so storing `{ url, expiresAt }` works without manual stringify/parse.

### Race condition

Two simultaneous cache misses will both generate a signed URL and the second `SET` overwrites the first. Both URLs are valid (different signatures but same object). The client holding the "losing" URL still works. No atomic operation is needed — the race is harmless.

---

## Cache Key Design

```
signed-url:{userId}:{storageKey}
```

- `userId` — scopes to the authenticated user; prevents cross-user URL exposure even if storage keys are guessable
- `storageKey` — the R2 object key (e.g. `userId/uuid.png`)
- Thumbnail and full-size keys differ naturally since `storageKey` differs between them

---

## Files to Change

| File | Change |
|---|---|
| `src/lib/storage/s3.ts` | Add `getCachedSignedDownloadUrl(userId, storageKey, fileName?)` returning `{ url, expiresAt }` |
| `src/app/api/download/[id]/url/route.ts` | Use `getCachedSignedDownloadUrl`; use returned `expiresAt` (drop `getSignedUrlExpiresAt()` call) |
| `src/lib/storage/s3.test.ts` | Tests for cache hit, cache miss, TTL, stored value shape |

---

## Implementation Plan

### 1. `src/lib/storage/s3.ts` — new function

```ts
import { redis } from '@/lib/infra/redis'

const CACHE_TTL_SECONDS = SIGNED_URL_TTL_SECONDS - 120  // 780 s

interface CachedSignedUrl {
  url: string
  expiresAt: string  // ISO 8601
}

export async function getCachedSignedDownloadUrl(
  userId: string,
  storageKey: string,
  fileName?: string,
): Promise<CachedSignedUrl> {
  const cacheKey = `signed-url:${userId}:${storageKey}`

  const cached = await redis.get<CachedSignedUrl>(cacheKey)
  if (cached) return cached

  const url = await getSignedDownloadUrl(storageKey, undefined, fileName)
  const expiresAt = getSignedUrlExpiresAt().toISOString()

  // Upstash TS client auto-serializes the object; ex sets TTL in seconds
  await redis.set(cacheKey, { url, expiresAt }, { ex: CACHE_TTL_SECONDS })

  return { url, expiresAt }
}
```

### 2. `src/app/api/download/[id]/url/route.ts` — update helper

```ts
// Before
async function signedDownloadUrlResponse(storageKey: string, fileName?: string) {
  const url = await getSignedDownloadUrl(storageKey, undefined, fileName)
  const expiresAt = getSignedUrlExpiresAt()
  return ApiResponse.OK<SignedDownloadUrlResponse>({ url, expiresAt: expiresAt.toISOString() })
}

// After
async function signedDownloadUrlResponse(userId: string, storageKey: string, fileName?: string) {
  const { url, expiresAt } = await getCachedSignedDownloadUrl(userId, storageKey, fileName)
  return ApiResponse.OK<SignedDownloadUrlResponse>({ url, expiresAt })
}
```

Pass `userId` from the outer route handler to `signedDownloadUrlResponse`.

### 3. Cache eviction on file delete

When an item is deleted, remove its cached signed URL so a subsequent fetch generates a fresh one. Wherever `deleteFromS3` is called in the delete flow, add:

```ts
await redis.del(`signed-url:${userId}:${storageKey}`)
```

Check `src/actions/items.ts` and any delete API routes for the right call site.

---

## Tests — `src/lib/storage/s3.test.ts`

Mock `redis` with `vi.mock('@/lib/infra/redis')`.

- **Cache miss** — `redis.get` returns `null` → calls `getSignedUrl` → calls `redis.set` with `{ url, expiresAt }` and `{ ex: 780 }` → returns correct shape
- **Cache hit** — `redis.get` returns `{ url, expiresAt }` → does NOT call `getSignedUrl` → returns stored value as-is
- **TTL constant** — `redis.set` is called with `{ ex: SIGNED_URL_TTL_SECONDS - 120 }`
- **expiresAt on hit** — returned `expiresAt` matches the stored value, not `Date.now() + 900s`

---

## Verification

```bash
npm run lint
npm run test:run
```

Manual check: open DevTools → Network. Load a page with image items, note the `X-Amz-Signature` value in the signed URL from `/api/download/[id]/url`. Refresh the page — the same signature should appear in the response (Redis cache hit). R2 image responses should show `(from disk cache)` in the browser.

---

## Notes

- `private` on `Cache-Control` stays unchanged — URLs are user-scoped, shared caches must not store them. The `ResponseCacheControl` header is baked into the signed URL at generation time and is preserved verbatim in the cached URL.
- Do not cache presigned POST credentials — those are single-use upload tokens with a separate Redis token system.
- No Prisma or schema changes needed.
- This is backend-only — no client component changes required.
