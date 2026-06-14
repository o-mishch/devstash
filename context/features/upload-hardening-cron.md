# Upload Sweep Cron

## Status
Not Started

## Context

The upload hardening feature (`context/features/upload-hardening-spec.md`) relies on `sweepExpiredUploads()` running after every `POST /api/upload/url` response via `after()` from `next/server`. This is opportunistic — if upload traffic stops, orphaned S3 objects (presigned but never used or never converted to items) are never reclaimed.

The cron closes this gap: a scheduled hourly job calls the same `sweepExpiredUploads()` helper, ensuring cleanup runs even during idle periods.

## Goals

- `GET /api/cron/sweep-uploads` exists and calls `sweepExpiredUploads()` from `src/lib/storage/upload-tokens.ts`
- Route verifies `Authorization: Bearer ${CRON_SECRET}` before doing anything; returns `401` if missing or wrong
- Route returns `ApiResponse.OK()` on success (sweep errors are already caught internally)
- `vercel.json` exists at the repo root with a cron entry pointing to `/api/cron/sweep-uploads` on an hourly schedule

## Notes

- **Files to touch:**
  - `src/app/api/cron/sweep-uploads/route.ts` — new file: GET handler with CRON_SECRET guard + `sweepExpiredUploads()`
  - `vercel.json` — new file: `{ "crons": [{ "path": "/api/cron/sweep-uploads", "schedule": "0 * * * *" }] }`

- **Constraints:**
  - `CRON_SECRET` is reserved/pre-configured — do NOT add it to `src/types/env.d.ts` or `.env.example`
  - Vercel automatically passes `Authorization: Bearer $CRON_SECRET` when invoking cron routes — verify this header in the handler
  - Wrap with `apiRoute` from `@/lib/api` — do not use raw `NextResponse`
  - No rate limiting needed — the CRON_SECRET is the only access control required
  - Sweep errors are non-fatal (already caught in `sweepExpiredUploads`) — always return OK if auth passes

- **Why the cron is safe to add:**
  - `sweepExpiredUploads` is idempotent — concurrent runs are safe (Redis DEL and S3 DeleteObject are both idempotent)
  - The sweep only acts on entries where `result.expiresAt < now`, so active in-progress uploads are never touched

## Reference

- `src/lib/storage/upload-tokens.ts` — `sweepExpiredUploads` implementation
- `context/features/upload-hardening-spec.md` — Issue 4 (lazy sweep design)
