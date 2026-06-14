# Signed URL Cache Optimization (Client localStorage Persistence)

## Overview

Persist the client-side signed URL cache to `localStorage` so it survives page refreshes. Currently, signed URLs are cached only in an in-memory `Map`, which is cleared on every page load. This optimization stores cached URLs in `localStorage` with expiry tracking so the same URL is reused across refreshes — eliminating the API round-trip entirely and keeping the browser disk cache effective.

**This spec is complementary to `signed-url-server-cache-spec.md`** (server-side Redis cache). The two layers work together:

| Layer | What it fixes |
|---|---|
| **Server Redis cache** (`signed-url-server-cache-spec.md`) | Same URL returned for all callers (any browser, any session, any device) within the TTL window — fixes the root cause of signature churn |
| **Client localStorage cache** (this spec) | Eliminates the API call to `/api/download/[id]/url` entirely on page refresh within the same browser |

With the server-side Redis cache in place, the API call on a page refresh is already cheap (Redis hit, no R2 call). This spec makes it free by skipping the API call altogether for the same browser.

**Impact:** Zero API calls for image URLs on page refresh within the signed URL TTL window.

---

## Problems

### Problem 1: Image Re-downloads on Page Refresh

#### Current Flow (without either cache)
```
Page Load 1:
  Hook fetches signed URL from API
  → Stores in memory cache: Map<'item-123:preview', {url, expiresAt}>
  → Browser downloads image bytes
  → Disk cache keyed to: https://r2.../key?X-Amz-Signature=abc123

Page Refresh:
  Memory cache cleared ❌
  Hook fetches signed URL from API
  → Backend generates new URL: https://r2.../key?X-Amz-Signature=xyz789  ← different signature
  → Browser sees different URL
  → Browser disk cache miss (URL changed)
  → Re-downloads same bytes ❌
```

#### With server-side Redis cache only (no localStorage)
```
Page Refresh:
  Memory cache cleared
  Hook fetches signed URL from API  ← API call still made
  → Redis returns cached URL: https://r2.../key?X-Amz-Signature=abc123  ← same signature ✅
  → Browser disk cache hit ✅
  → No re-download ✅  (but API call still happens)
```

#### With both Redis + localStorage
```
Page Refresh:
  localStorage hit: https://r2.../key?X-Amz-Signature=abc123  ← no API call ✅
  → Browser disk cache hit ✅
  → No re-download ✅
```

#### Root Cause (this spec)

The in-memory `Map` cache is lost on page refresh. The server-side Redis cache fixes the signature-churn problem. This spec fixes the residual API call on refresh by persisting the URL to `localStorage`.

---

### Problem 2: Redundant S3 Calls on Item Drawer Open (404 Errors)

**Current behavior:**
1. User clicks image card on `/items/images` page
2. Item drawer opens
3. Expected: 1 network call to backend → `/api/items/{id}/details`
4. Real: 1 backend call + 1–2 redundant S3 calls that return 404

**Example:**
```
Request: GET https://s3.filebase.io/devstash-files/.../file.png?X-Amz-Signature=...
Response: 404 Not Found
```

**Root cause:** Unknown — likely:
- Stale signed URLs in image component state (expired, signature invalid)
- Multiple fetch attempts for full-size image (hook called multiple times)
- Image component retrying failed preview URL before detail loads
- Overeager image preloading before signed URLs are ready

**Impact:** 
- Wasted bandwidth (failed requests)
- Slower drawer open (waiting for 404s)
- Network logs cluttered with failed requests

---



---

## Solution

Persist the signed URL cache to `localStorage` with expiry tracking. On page refresh:
1. Load cache from `localStorage` (filter out expired entries)
2. Populate in-memory `Map` from the loaded entries
3. Hook returns cached URL without an API call
4. Browser sees the same URL → disk cache hit → no re-download

### Fixed Flow
```
Page Load 1:
  Hook fetches signed URL from API
  → API returns { url, expiresAt } (expiresAt is accurate — from server-side Redis cache)
  → Stores in memory Map AND localStorage: { 'item-123:preview': { url, expiresAt } }
  → Browser downloads image bytes
  → Disk cache keyed to: https://r2.../key?X-Amz-Signature=abc123

Page Refresh:
  Memory Map cleared (expected)
  Hook loads from localStorage → non-expired entries repopulate Map
  → Returns: https://r2.../key?X-Amz-Signature=abc123  (no API call) ✅
  → Browser disk cache hit ✅
  → No re-download ✅
```

**`expiresAt` accuracy:** With the server-side Redis cache (`signed-url-server-cache-spec.md`), the `expiresAt` returned by the API reflects when the cached URL actually expires — not `now + 900s`. This means the localStorage expiry check is accurate: the client won't serve a stale URL because `expiresAt` is the real deadline.

---

## Requirements

### Storage Structure
```javascript
// localStorage key: '__devstash_signed_urls'
// Value: JSON array of [cacheKey, cachedEntry]
[
  ["item-123:preview", { url: "https://...", expiresAt: 1718097600000 }],
  ["item-456:full", { url: "https://...", expiresAt: 1718184000000 }]
]
```

### Implementation Details

1. **Add helper functions to `src/hooks/use-pro-download-src.ts`:**
   - `loadCacheFromStorage()` — Load from localStorage on app boot, validate expiry
   - `persistCacheToStorage()` — Save non-expired entries to localStorage after each cache update
   - Update `cacheSignedDownloadUrl()` to call `persistCacheToStorage()` after caching
   - Update `clearSignedDownloadUrlCache()` to call `persistCacheToStorage()` after clearing
   - Update `getCachedSignedDownloadUrl()` to call `persistCacheToStorage()` when deleting expired entries

2. **On hook first call:**
   - Load from localStorage once (flag-based, single load)
   - Populate in-memory cache from localStorage
   - Subsequent calls use memory cache as before

3. **Expiry Management:**
   - Keep existing 30s buffer: `expiresAt - 30000 > Date.now()` before returning
   - Only persist non-expired entries to localStorage
   - Gracefully handle storage errors (quota exceeded, disabled)

### Code Pattern

```typescript
// In use-pro-download-src.ts
const STORAGE_KEY = '__devstash_signed_urls'

function loadCacheFromStorage(): void {
  if (typeof window === 'undefined') return
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return
    const entries = JSON.parse(stored) as Array<[string, CachedSignedDownloadUrl]>
    for (const [key, value] of entries) {
      // Only load non-expired entries
      if (value.expiresAt - SIGNED_URL_EXPIRY_BUFFER_MS > Date.now()) {
        signedDownloadUrlCache.set(key, value)
      }
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY) // Corrupt data
  }
}

function persistCacheToStorage(): void {
  if (typeof window === 'undefined') return
  try {
    // Only persist non-expired entries
    const entries = Array.from(signedDownloadUrlCache.entries()).filter(
      ([, value]) => value.expiresAt - SIGNED_URL_EXPIRY_BUFFER_MS > Date.now()
    )
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // Silently ignore storage quota exceeded or disabled
  }
}

// Call loadCacheFromStorage() once on first useProDownloadSrc() call
// Call persistCacheToStorage() after each cache update/clear
```

---

## Files Modified

| File | Change |
|------|--------|
| `src/hooks/use-pro-download-src.ts` | Add localStorage persistence (+ 60 lines) |

---

## Verification

### Automated
- `npm run lint` — No new lint issues
- `npm run test:run` — All tests pass (no changes to existing tests needed; logic is transparent)

### Manual Browser Testing

1. **Open DevTools → Network tab, filter by images**
2. **Load dashboard with image items:**
   - Count requests: should show image downloads
   - Note first request count (e.g., 10 images)
3. **Refresh page:**
   - Network tab shows request for `/api/download/...` calls
   - Check if re-made or skipped
   - Expect: API calls skipped (cache hit from localStorage)
   - Image responses: should show `(from disk cache)` or Status 200 with 0 bytes
4. **After 1 hour:**
   - Signed URLs expire
   - Next page load: new API calls (expected, URLs are now stale)
   - New image downloads (expected)

---

## Success Criteria

| Metric | Before | After | Verification |
|--------|--------|-------|---|
| **Image re-downloads on refresh** | 100% | ~0-5% (only if URL expired) | DevTools Network tab |
| **API calls on page refresh** | 1 per image | 0 (unless expired) | DevTools Network XHR filter |
| **Browser HTTP cache effectiveness** | Can't work (URL changes) | Works (URL stable) | DevTools Network cache column |
| **localStorage usage** | 0 | ~200 bytes per cached image | DevTools Application > localStorage |
| **Session persistence** | — | Survives tab close/reopen (until URL expires) | Manual: close tab, reopen, load page |

---

## Edge Cases

### Storage Quota Exceeded
- localStorage.setItem() throws → catch block silently ignores
- Fallback: Cache still works in memory for current session
- Next refresh: fresh API call (expected degradation)

### Disabled Storage
- `typeof window === 'undefined'` → skip storage ops
- SSR-safe, works with server components

### Corrupt Data in localStorage
- JSON.parse() throws → `localStorage.removeItem()` clears it
- Next call: fresh API fetch, re-caches correctly

### URL Expiry
- 30s buffer checked before returning
- On expiry: deleted from both memory and localStorage
- Next request: fresh API call

---

## Timeline

**Estimated:** ~1–2 hours
- Implement helpers: 30 min
- Hook integration: 15 min
- Testing & verification: 45 min

---

---

## Problem 3: Download File Opens in S3 Tab Instead of Save Dialog

**Current behavior:**
1. User clicks "Download" button on item
2. Expected: System file save dialog appears (user chooses where to save)
3. Real: Redirects to S3 page, opens in same tab, browser auto-downloads (if enabled) or shows S3 interface

**Root cause:** Download link points directly to signed S3 URL, no middleware to trigger `Content-Disposition: attachment` header

**Impact:**
- Poor UX (page navigation, context loss)
- No control over filename/location
- Mobile users can't save to device
- Browser's download manager not engaged

**Solution (separate from signed-URL cache):**
- Create `/api/download/{id}` route that:
  - Fetches signed URL from existing endpoint
  - Sets `Content-Disposition: attachment; filename=...`
  - Proxies file from S3 (or redirects with proper headers)
- Update download button to use this route instead of direct S3 link
- Handle both Pro (full file) and Free (preview) downloads

---

## Notes

- **Cache key is `itemId:preview`** — already correct, no changes needed. Same key = same URL reused.
- **No backend changes** — entirely client-side optimization; works independently of the server-side Redis cache but is most effective when combined with it.
- **No component changes** — transparent to components; the hook handles it.
- **Backward compatible** — if `localStorage` is disabled or unavailable, falls back to in-memory cache only (no errors, just no cross-refresh persistence).
- **Security unchanged** — signed URLs still expire server-side; the 30 s client-side buffer prevents serving a URL in its final seconds before invalidation.
- **`expiresAt` source** — when the server-side Redis cache is in place, the API returns the true URL expiry (not `now + 900s`), so the localStorage expiry check is accurate without any client-side adjustments.
- **Implement after** `signed-url-server-cache-spec.md` — the server cache fixes the root cause (signature churn); this spec eliminates the residual API call. Both together give the best result.

---

## Related Issues (Out of Scope for This Feature)

These issues are identified but not addressed by signed-URL cache optimization:

| Issue | Spec | Priority |
|-------|------|----------|
| **Redundant S3 calls (404s) on drawer open** | Problem 2 above | Medium (investigate cause) |
| **Download redirect to S3 instead of save dialog** | Problem 3 above | Low (UX improvement) |
| **No server-side file size enforcement on upload** | Problem 4 below | Medium (security hardening) |

**Recommended next steps after signed-URL cache:**
1. Debug and fix redundant S3 calls on drawer open
2. Implement proper download route with attachment headers
3. Replace PUT presigned URL with POST presigned policy for upload size enforcement

---

## Problem 4: Upload Size Limits Are Not Enforced at the Storage Layer

### Current flow (broken)

```
Browser                     Backend                     Filebase
  │                            │                            │
  │── POST /api/upload/url ───>│                            │
  │   { fileName, fileSize }   │ trust declared fileSize ✓  │
  │                            │ issue PUT presigned URL    │
  │<── { originalUrl } ───────│ (no size constraint)       │
  │                            │                            │
  │── PUT originalUrl ────────────────────────────────────>│
  │   [body: any size]         │              accepts ✓     │
  │                            │        (no enforcement)    │
```

`fileSize` is declared by the client. The PUT presigned URL carries no payload conditions. A client that declares `fileSize: 1` receives a valid URL and can PUT a file of any size.

**Current validation layers:**

| Layer | Checks | Trust |
|---|---|---|
| Client (`file-upload.tsx:71`) | `file.size > config.maxBytes` | Untrusted — UX only |
| Server (`url/route.ts:41`) | Declared `fileSize > maxBytes` | Trusted — but trusts client value |
| Storage (Filebase) | Nothing | No enforcement |

---

## Solution: Presigned POST Policy

The backend issues a presigned upload credential with the maximum file size cryptographically encoded and signed inside it. The browser POSTs directly to Filebase using that credential. Filebase enforces the size limit from the credential itself, before accepting any bytes. The backend also returns plain `maxBytes` alongside the credential so the browser knows what constraint is encoded — for UI display and early client-side rejection.

### Fixed flow

```
Browser                     Backend                     Filebase
  │                            │                            │
  │── POST /api/upload/url ───>│                            │
  │   { fileName, itemType }   │ look up maxBytes by type   │
  │   (no fileSize)            │ sign credential:           │
  │                            │   content-length-range     │
  │                            │   1 … maxBytes             │
  │<── {                      │                            │
  │     presignedCredential,  │ ← constraint encoded here  │
  │     maxBytes              │ ← same value, plain text   │
  │    } ─────────────────────│   for browser UX only      │
  │                            │                            │
  │── POST Filebase ──────────────────────────────────────>│
  │   [credential + file]      │  verify HMAC signature ✓   │
  │                            │  check content-length ✓    │
  │                            │  > maxBytes? → 413 ✗       │
```

The size limit is no longer a claim the client makes — it is baked into a signed credential that Filebase validates independently, without the app being involved.

### Credential structure (returned by backend)

An S3 POST policy credential consists of a target URL and a set of signed fields that the browser includes in the multipart POST body. Together they form the "presigned URL" for the upload:

```ts
interface PresignedCredential {
  url: string                      // Filebase bucket endpoint to POST to
  fields: Record<string, string>   // signed policy + metadata
}

// fields contains:
// {
//   key: "userId/uuid.png",
//   Content-Type: "image/png",
//   policy: "eyJ...",                  // base64-encoded conditions incl. content-length-range
//   x-amz-signature: "3e4f...",        // HMAC-SHA256 over the policy — tamper-proof
//   x-amz-algorithm, x-amz-credential, x-amz-date
// }
```

The browser cannot change the size limit encoded in `policy` without invalidating `x-amz-signature`.

### How the browser uses the credential

```ts
// maxBytes returned by backend — use for early UX check only
if (file.size > maxBytes) {
  setError(`File exceeds the ${maxBytes / 1024 / 1024}MB limit.`)
  return
}

// POST directly to Filebase — all policy fields must precede the file
const form = new FormData()
Object.entries(presignedCredential.fields).forEach(([k, v]) => form.append(k, v))
form.append('Content-Type', contentType)
form.append('file', file)   // file must be last per S3 POST spec

await fetch(presignedCredential.url, { method: 'POST', body: form })
// Filebase returns 413 if body > maxBytes encoded in the credential
```

---

## Implementation Plan

### 1. Install package

```bash
npm install @aws-sdk/s3-presigned-post
```

### 2. Add `getPresignedPostCredential` to `src/lib/storage/filebase.ts`

```ts
import { createPresignedPost } from '@aws-sdk/s3-presigned-post'

interface PresignedPostCredential {
  url: string
  fields: Record<string, string>
}

export async function getPresignedPostCredential(
  key: string,
  contentType: string,
  maxBytes: number,
  expiresIn = SIGNED_URL_TTL_SECONDS
): Promise<PresignedPostCredential> {
  const { url, fields } = await createPresignedPost(getClient(), {
    Bucket: getBucket(),
    Key: key,
    Conditions: [
      ['content-length-range', 1, maxBytes],
      ['eq', '$Content-Type', contentType],
    ],
    Fields: { 'Content-Type': contentType },
    Expires: expiresIn,
  })
  return { url, fields }
}
```

### 3. Update `src/app/api/upload/url/route.ts`

Remove `fileSize` from the request schema — `maxBytes` is determined by `itemType` on the server. Return the presigned credential and `maxBytes` plainly.

```ts
// Request schema: fileSize removed
const uploadUrlSchema = z.object({
  fileName: z.string().trim().min(1),
  itemType: z.enum(['image', 'file']),
  hasThumb: z.boolean(),
})

// Response
const original = await getPresignedPostCredential(originalKey, contentType, maxBytes)
return ApiResponse.OK({ originalKey, original, maxBytes, ..., expiresAt })
// original = { url, fields } — size encoded in fields.policy
// maxBytes = plain number for browser UX
```

### 4. Update `src/components/shared/file-upload.tsx`

Use server-returned `maxBytes` for the client-side guard (replaces hardcoded constant). Replace bare `apiUpload` PUT with multipart form POST using the credential fields.

```ts
const { original, maxBytes } = urlResult.data

// Early UX check using the server-declared limit
if (file.size > maxBytes) {
  setError(`File exceeds the ${maxBytes / 1024 / 1024}MB limit.`)
  return
}

// POST to Filebase using the signed credential
const form = new FormData()
Object.entries(original.fields).forEach(([k, v]) => form.append(k, v))
form.append('Content-Type', contentType)
form.append('file', file)   // must be last
await fetch(original.url, { method: 'POST', body: form })
```

---

## Files Modified

| File | Change |
|---|---|
| `package.json` | Add `@aws-sdk/s3-presigned-post` |
| `src/lib/storage/filebase.ts` | Add `getPresignedPostCredential()` |
| `src/app/api/upload/url/route.ts` | Remove `fileSize` from request; return presigned credential + plain `maxBytes` |
| `src/components/shared/file-upload.tsx` | Use server-returned `maxBytes`; POST multipart form using credential |

---

## Verification

### Prerequisite: Filebase compatibility test

`createPresignedPost` is standard AWS S3 API. Filebase advertises S3 compatibility but does not explicitly document POST policy support. Run a manual probe first:

```ts
const credential = await getPresignedPostCredential('test/probe.txt', 'text/plain', 100)
// POST a 50-byte file → expect 200
// POST a 200-byte file → expect 413 EntityTooLarge
```

If Filebase returns `501 Not Implemented` or `403 Forbidden`, use the HEAD-check fallback instead.

### Automated
- `npm run lint` — no issues
- `npm run test:run` — all tests pass

### Manual browser testing
1. Upload a valid file within limit → succeeds
2. Bypass client guard and attempt oversized upload → Filebase returns `413`, UI shows error
3. Tamper with credential fields in DevTools → Filebase returns signature mismatch error

---

## Fallback: HEAD Check After Upload

If Filebase does not support POST policies, verify size server-side after the upload. In `createItemAction`, before writing to DB:

```ts
const head = await getClient().send(new HeadObjectCommand({ Bucket, Key: fileKey }))
if (head.ContentLength! > maxBytes) {
  await deleteFromFilebase(fileKey)
  return ApiResponse.BAD_REQUEST('File exceeds the size limit.')
}
```

**Trade-off:** The oversized bytes are transferred and stored briefly before deletion. The POST policy approach rejects at the storage edge before any bytes land — better for cost and latency, but depends on Filebase support.
