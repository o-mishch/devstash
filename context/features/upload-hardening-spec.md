# Upload Hardening

## Overview

Four security and reliability gaps in the file/image upload flow, addressed together because they share infrastructure (Redis, presigned POST policy).

## Status

Planned

---

## Issue 1 — Payload simplification

**Current:** Client sends `{ fileName, fileSize, itemType, hasThumb }` to `POST /api/upload/url`.

**Problem:** `itemType` and `hasThumb` are redundant — the server can derive both from the extension:
- `itemType`: `ALLOWED_IMAGE_EXTS` and `ALLOWED_FILE_EXTS` are disjoint; extension alone determines which rule set applies
- `hasThumb`: `canGenerateImageThumbnail(key)` already encodes the same logic (in allowed image set, not svg)

**Fix:** Remove both fields from the Zod schema and derive them server-side. Minimal payload becomes `{ fileName, fileSize }`.

`fileSize` stays: the server validates it and returns a user-friendly error before the client attempts the S3 POST.

**Files:**
- `src/app/api/upload/url/route.ts` — remove `itemType` and `hasThumb` from schema; derive both from extension
- `src/components/shared/file-upload.tsx` — remove `itemType` and `hasThumb` from the `post('/api/upload/url', ...)` call body

---

## Issue 2 — Thumb size not enforced at storage layer

**Current:** The original upload uses `createPresignedPost` with `content-length-range` baked into the signed policy — S3 enforces it. The thumb upload uses a PUT presigned URL (`getSignedUploadUrl`) which enforces `Content-Type` only, not size.

**Why it matters:** A non-browser client can bypass `buildImageThumb` and POST an arbitrarily large object to the thumb PUT URL.

**How POST policy enforcement works:** The policy JSON (including `content-length-range` and `Content-Type` conditions) is HMAC-SHA256 signed with the AWS secret key. The client receives the base64 policy + signature but cannot modify either without the secret key — S3 rejects any upload that violates a condition with 403. The constraint is cryptographically bound.

**Fix:** Replace `getSignedUploadUrl` for thumbnails with `getPresignedPostCredential(thumbKey, 'image/webp', THUMB_MAX_BYTES)`. Update the client to use FormData POST for the thumb upload, same pattern as the original.

**Constants to add:**
```ts
export const THUMB_MAX_BYTES = 100 * 1024  // 100 KB
```

**Files:**
- `src/lib/utils/constants.ts` — add `THUMB_MAX_BYTES`
- `src/app/api/upload/url/route.ts` — replace `getSignedUploadUrl(thumbKey, 'image/webp')` with `getPresignedPostCredential(thumbKey, 'image/webp', THUMB_MAX_BYTES)`
- `src/lib/storage/s3.ts` — delete `getSignedUploadUrl` (no remaining callers after the route change)
- `src/types/item.ts` — change `thumbUrl: string | null` in `UploadUrlResult` to `thumb: PresignedPostCredential | null`
- `src/components/shared/file-upload.tsx` — replace PUT upload of thumb blob with FormData POST using the credential fields

---

## Issue 3 — No provenance validation on item creation

**Current:** `createItemAction` accepts any `fileUrl` that starts with `${userId}/` (checked by `isOwnedFileReference`). It does not verify that the key was actually issued by `/api/upload/url` in this session. Consequences:
- A client can reference an old orphaned key from a previous upload
- `fileSize`, `fileName`, `imageWidth`, `imageHeight` are stored as-is from the client — never cross-checked against what the server issued
- `content`, `language`, `url` can be sent for `image`/`file` item types and will be stored even though they are meaningless for those types

**Fix — upload token:**

The S3 object key itself serves as the upload token — it already embeds a `crypto.randomUUID()` (`${userId}/${uuid}.${ext}`) and is cryptographically unguessable by other users.

1. In `/api/upload/url`, build `originalKey = \`${userId}/${crypto.randomUUID()}.${ext}\``
2. Store in Redis hash keyed by `originalKey`:
   ```
   HSET pending_uploads {key} JSON({ result: UploadUrlResult, userId, fileName, fileSize })
   ```
   `fileName` and `fileSize` are stored here so `createItemAction` can retrieve them from the server rather than trusting the client.
3. The client receives the key via `original.fields['key']` (already present in the presigned POST credential) — no separate token field is needed in the response
4. In `createItemAction`, `fileUrl` (= the S3 key) is used as the lookup key
5. Look up the entry: must exist, `userId` must match session
6. On success: `HDEL pending_uploads {key}` — single-use, consumed immediately; return `{ fileName, fileSize }` to the action
7. On lookup failure (missing, wrong user): return `ApiResponse.FORBIDDEN`
8. On Redis unavailability during write (in the route): return `INTERNAL_ERROR` — upload is blocked; on Redis unavailability during consume (in the action): return `INTERNAL_ERROR`

**Fix — strip irrelevant fields:**

Add cross-field cleanup in `createItemAction` to zero out fields that don't apply to the item type:
- `image`/`file` types: null out `content`, `language`, `url`
- Other types: null out `fileUrl`, `imageWidth`, `imageHeight`

**Files:**
- `src/app/api/upload/url/route.ts` — write to Redis hash, `after()` sweep
- `src/actions/items.ts` — token lookup + consumption via `fileUrl`; cross-type field cleanup; `fileName`/`fileSize` from Redis
- `src/components/shared/file-upload.tsx` — `UploadedFile.key` (existing field) carries the token; no new fields needed
- `src/components/items/item-create-dialog.tsx` — passes `uploadedFile.key` as `fileUrl` to `createItemAction`
- `src/lib/utils/validators.ts` — remove `isOwnedFileReference` (superseded by token validation)

---

## Issue 4 — Orphaned S3 objects on page refresh / crash

**Current:** The create dialog calls `deleteOrphanedFile` when the user explicitly closes it without saving. But if the user refreshes the page or closes the tab after the S3 upload completes, the cleanup callback never fires. The S3 object lives forever with no linked DB record.

**Fix — lazy sweep using `after()`:**

No external scheduler is needed. Every `POST /api/upload/url` response triggers a background sweep via `after()` from `next/server`. The sweep runs after the response is sent and does not block the client.

**Sweep logic:**
1. `HGETALL pending_uploads` — fetch all pending entries
2. For each entry where `result.expiresAt < now`: the presigned URL has expired, meaning no `createItemAction` can ever consume this entry successfully (the client's upload window has closed)
   - Delete `key` (the hash field name) from S3
   - Delete `thumbKey` from S3 if present (`result.thumb?.fields['key']`)
   - `HDEL pending_uploads {key}`
3. Log count of entries swept

**Why there is no race with a concurrent create:**

The two operations cannot conflict:
- Token consumed by `createItemAction` → `HDEL` removes it from the hash before the sweep can find it
- Upload still in progress (< 900s old) → sweep's age filter skips it
- Item creation + upload completing in seconds, well inside the 900s window → the sweep never touches active entries

If two concurrent sweeps run, `HDEL` is atomic (second call returns 0) and `deleteFromS3` is idempotent on the S3 side — both are safe.

**Files:**
- `src/app/api/upload/url/route.ts` — add `after(sweepExpiredUploads)` before returning the response; extract `sweepExpiredUploads` to `src/lib/storage/upload-tokens.ts` alongside the token write/consume helpers

---

## Data Flow After All Fixes

```
Client                         Server (/api/upload/url)          Redis              S3
  │                                     │                          │                 │
  │─ POST { fileName, fileSize } ──────>│                          │                 │
  │                                     │ derive itemType, thumb   │                 │
  │                                     │ key = userId/uuid.ext    │                 │
  │                                     │── HSET pending_uploads ─>│                 │
  │                                     │   key → { result,        │                 │
  │                                     │     userId, fileName,    │                 │
  │                                     │     fileSize }           │                 │
  │                                     │                          │                 │
  │                                     │ after(): sweepExpired()  │                 │
  │                                     │── HGETALL ──────────────>│                 │
  │                                     │   filter result.expiresAt│                 │
  │                                     │── deleteFromS3(stale) ─────────────────────>
  │                                     │── HDEL stale entries ───>│                 │
  │                                     │                          │                 │
  │<─ { original, thumb, expiresAt } ───│                          │                 │
  │   key in original.fields['key']     │                          │                 │
  │                                     │                          │                 │
  │─ POST FormData (original) ─────────────────────────────────────────────────────>│
  │   (original.fields + file)          │               S3 enforces size + type      │
  │─ POST FormData (thumb) ────────────────────────────────────────────────────────>│
  │   (thumb.fields + blob)             │               S3 enforces 100KB + webp     │
  │                                     │                          │                 │
  │─ createItemAction({ fileUrl: key })>│                          │                 │
  │                                     │── HGET pending_uploads ─>│                 │
  │                                     │<─ { userId, fileName,    │                 │
  │                                     │    fileSize, ... } ──────│                 │
  │                                     │ validate userId          │                 │
  │                                     │── HDEL pending_uploads ─>│  (consumed)     │
  │                                     │ write DB (fileName,      │                 │
  │                                     │   fileSize from Redis)   │                 │
  │<─ ApiResponse.CREATED ──────────────│                          │                 │
```

---

## Implementation Order

1. **Issue 1** — payload simplification (no new deps, pure route + client change)
2. **Issue 2** — thumb POST policy (swap `getSignedUploadUrl` for `getPresignedPostCredential` on thumb; update client to FormData POST)
3. **Issue 3** — upload token (Redis write on presign, validate + consume on create, strip irrelevant fields)
4. **Issue 4** — lazy sweep (add `after(sweepExpiredUploads)` to upload URL route; reads the same Redis hash from Issue 3)
