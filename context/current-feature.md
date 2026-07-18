# Current Feature: Backend → Go + Frontend → Vite SPA

Strangler migration of the Next.js app into a Go API (`backend/` — Huma v2 + sqlc + goose on Cloud Run) and a Vite SPA (`web/` — TanStack Start). The legacy Next.js app keeps serving the live apex `devstash.one` on Vercel, untouched, for the whole migration; the new stack runs standalone (`api.devstash.one` + `beta.devstash.one`) until a final apex cutover.

Integration branch: `feature/go-backend-vite-spa` (off `main`'s Vercel deploy path).

## Status

| Phase | State |
|---|---|
| Backend 0 — Go skeleton + Cloud Run deploy | ✅ |
| Backend 1 — auth/session (credentials + OAuth github/google) | ✅ |
| Backend 2 — items + collections + search (15 secured ops) | ✅ |
| Frontend F0 — Vite SPA foundation (router, session, CSP) | ✅ |
| Frontend F1 — auth pages (all 6) | ✅ |
| Frontend F2 — dashboard, `/items/[type]`, `/collections`, `/favorites` | ✅ |
| Frontend F3 — marketing homepage + `/` prerender | ✅ |
| **Backend 3 — file/image upload (S3 presign)** | ⬜ **next** |
| Backend 4 — profile → then unblocks F2 `/profile` | ✅ |
| Backend 5 — Stripe/billing → then unblocks F2 `/settings` | ⬜ |
| Backend 6 — AI brain-dump + realtime | ⬜ |

**F2 is hard-sequenced behind its backend phase** — a page ships only after its data domain is on Go. `/profile` and `/settings` stay on the legacy Vercel app until Phases 4 and 5 land.

External cutover steps (DNS, OAuth allowlists, deleting legacy handlers) are pending and tracked in the migration log — none are done yet.

## Where the rest lives

- **Standing constraints** — Prisma frozen (never `prisma db push`), `backend/` is 100% Go, never touch the Neon `production` branch, no cross-stack imports: `.agents/rules/boundary.md`.
- **Go backend standards** — vertical slices, validation/errors, IDOR scoping, data access, testing: `.agents/rules/go-coding-standards.md`.
- **`web/` gates** — the deliberate no-tests policy and what to run instead: `.agents/rules/web-architecture.md`.
- **`context/migration-log.md`** — the full migration record: architecture decisions and their rationale, what each shipped phase contains, the frontend stack/design/CSP build, and the pending external cutovers. **Load it when** you need to know *why* a migration decision was made, what a shipped phase actually contains, or which cutover steps remain — not for routine work inside an already-shipped area.
