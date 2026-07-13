# Current Feature: Backend → Go + Frontend → Vite SPA (Full Rewrite)

Strangler migration of the Next.js app into a Go API (`backend/`, Huma v2 + sqlc + goose on Cloud Run) and a Vite SPA (`web/`, TanStack Start). The old Next.js app keeps serving the live apex `devstash.one` on Vercel untouched for the whole migration; the new stack runs standalone (`api.devstash.one` + `beta.devstash.one`) until a final apex cutover. Prisma schema is frozen from Phase 0 on; goose owns all schema changes.

## Status

- ✅ **Phase 0** — Go skeleton + Cloud Run deploy (live, `/health` 200).
- ✅ **Phase 1** — Auth/session foundation (credentials, email/password, OAuth github/google).
- ✅ **Phase 2** — Items + Collections + Search backend (15 secured ops). Gates green (lint 0, race pass, coverage 88.7%). Merged to `feature/go-backend-vite-spa`.
- ⬜ **Frontend F0** — unblocked, next up. Then F1/F2/F3, and Phases 3–6.
- Pending cutovers (external, not backend code) tracked in [Remaining / cutover](#remaining--cutover).

`feature/go-backend-vite-spa` is the integration branch (off `main`'s Vercel deploy path).

## Architecture (authoritative decisions)

### Repo shape
- `backend/` — 100% Go module, single Cobra binary (`cmd/api/main.go`) with `serve`/`migrate`/`openapi` subcommands. No `package.json`/Node anywhere inside.
- `web/` — Vite + TanStack Start SPA; `@hey-api/openapi-ts` runs only here.
- Root `Taskfile.yml` `task dev` runs `air` (Go hot-reload) + `vite dev` concurrently via sub-Taskfiles.
- `src/app/api/*` handlers deleted domain-by-domain as each backend phase cuts over; `src/` fully deleted when Phase 6 + F3 finish.
- goose migrations at `backend/db/migrations/` (real dir, never a symlink into `prisma/`), embedded into the binary via `backend/db/embed.go`.

### Backend service model (auth/session)
- **Composed Go libs, no identity server:** `alexedwards/scs` + `scs/goredisstore`, `golang.org/x/oauth2`, `golang.org/x/crypto/bcrypt` (reads existing `bcryptjs` hashes as-is), `redis/go-redis/v9`. Reuses `users`/`accounts` unchanged.
- **Opaque stateful session in Redis** (keys `scs:session:<token>`). Session load is on every authed request's hot path; Neon is connection-limited, so sessions stay off it. Native TTL expiry, instant `DEL` revocation, `RenewToken` on login/logout for fixation. The NextAuth `sessions` table is abandoned (forced re-login — **no JWE decode shim**, the highest-risk surface dropped).
- **Session envelope reproduced on the scs session:** `SESSION_MAX_AGE=24h`, `SESSION_UPDATE_AGE=60s` re-persist granularity, password-fingerprint invalidation, idle timeout, transient-DB-error preservation. `lastActiveAt` stored as Unix `int64` (all gob built-ins).
- **Transport-agnostic resolution:** session lookup is `token → userID` (takes a token string, not `*http.Request`). Cookie is wired now; a `Authorization: Bearer` extractor is a ~10-line later add. No inert Bearer code ships now.
- **Cookie:** `__Host-session`, `SameSite=Lax`, `Secure`, **host-only** (no `Domain`; `COOKIE_DOMAIN` empty). `beta.`→`api.` is same-site (shared `devstash.one` eTLD+1), so `Lax` sends it on credentialed cross-origin XHR incl. POST/PATCH; `__Host-` prefix gives browser-enforced host-only scope vs sibling-subdomain cookie injection.
- **CSRF:** stdlib `net/http.CrossOriginProtection` (Sec-Fetch-Site + Origin/Host) + `rs/cors`, both keyed on `ALLOWED_ORIGINS`. `CrossOriginProtection` rejects `Sec-Fetch-Site: same-site` unless the origin is allowlisted → closes the sibling-subdomain gap `Lax` alone leaves open. Allowlist is load-bearing, keep it tight (never `*`). No CSRF token needed. **Never mutate state on GET.**
- **Client IP:** `clientIP(xff, trustedHops)` trusts XFF from the **right** (`TRUSTED_PROXY_DEPTH`, default 0 for Cloud Run direct; 1 behind a Global ALB) — the leftmost-trust Next port was a rate-limit-bypass vuln.
- **HSTS** on the Go API (Cloud Run doesn't add it): `Strict-Transport-Security: max-age=31536000; includeSubDomains` (add `preload` only after the apex leaves Vercel).
- **Every route is a Huma operation** (uniform OpenAPI, `Operation.Security`-driven middleware; OAuth 302s via `DefaultStatus:302` + output-header fields). Auth files group **by flow** (login/register/password/oauth/tokens), not file-per-op — coupled flows, unlike independent CRUD domains.
- Config via `caarlos0/env` (struct tags = existing `.env` names, no renames); only `DATABASE_URL` + `REDIS_URL` are required. `API_BASE_URL` builds OAuth `redirect_uri` (distinct from the SPA URL the callback 302s to). `REDIS_URL` is provider-agnostic (`redis.ParseURL`).

### Backend domain pattern (vertical slices — the template every CRUD domain copies)
- One package per domain, **one file per operation** (`create.go`, `list.go`, …). A `<domain>.go` holds `Deps`/`Service`/`New(Deps) *Service`/`Register(api, Deps)` + the narrow **consumer-defined store interface** (declared in-package, satisfied by sqlc `*Queries`) + `enforceLimit`. Embedded `Deps`, pointer-receiver methods.
- Cross-domain wire DTOs live in `internal/apitypes` (Huma keys schema components by Go base-name → extract shared types so each emits one component).
- **Validation:** Huma struct tags for presence/format/length/enum + a `huma.Resolver` `Resolve(ctx) []error` for what tags can't express (trim-then-min, `""`→null coercion, http/https-or-empty URL, per-type presence, discriminated-union). No `go-playground/validator`, no hand-rolled `parseOr422`. Huma-native RFC 9457 errors; opaque 500 via `genericErrorMessage` (real error logged, not leaked).
- **IDOR:** every sqlc query scoped by session `userId` (`middleware.CurrentUserID(ctx)`), never a path/body/query value. `cmd/api/security_guard_test.go` default-deny gate must stay green (secured ops never added to `publicOperations`).
- **Writes** are single multi-CTE statements (insert/update + connect-or-create tags via the implicit `_ItemTags` join `A`/`B` + relink collections + `RETURNING`) — one interface method, fakeable, no transaction plumbing. New ids from injected `IDs func() string` (UUIDv7).
- **Reads:** keyset (row-value) pagination, fetch-N+1 `hasMore`; `COALESCE(LEFT(col,150),'')::text` previews mapped `""`→`null`; collections via `jsonb_agg`→`[]byte`.
- **Rate limiting:** only where parity exists. `ratelimit.BucketItemMutation` (120/1h, keyed by `userId`) on item mutations; **no** collection/search bucket.

### Frontend stack (F0–F3)
- **TanStack Start in SPA mode** (`spa: { enabled: true }`) — static build, no server runtime, deploys to Firebase. Adopted at F0 (one stack F0→F3, no mid-project migration; F3 just enables `/` prerender). ⚠ Start is a **v1.0 RC, not GA** — **pin the exact `@tanstack/react-start` version**, watch the changelog. (Vike was the mature alternative, passed over for TanStack ecosystem cohesion + type-safe routing.)
- **Vite + TanStack Query + Zustand.** `autoCodeSplitting: true` (not `.lazy.tsx`), `defaultPreload: 'intent'`, dev `vite.config.ts` proxies `/api/*` → local Go (same-origin, no CORS in dev).
- **API client = `@hey-api/openapi-ts`** Fetch client + its TanStack Query plugin (options-based `queryOptions()` compose with `ensureQueryData`). ⚠ Pre-1.0, ESM-only, ~15 breaking/release, fetch client not default — **pin exact version**, treat regen as a reviewed event, generate once vs the real Huma 3.1 spec and eyeball unions/nullables. `baseUrl` = `/api` (dev proxy) / `https://api.devstash.one` (prod, `credentials: 'include'`).
- **Auth guard = router context + `beforeLoad`** (not a root-layout component guard — that's the Next-middleware anti-pattern). `createRootRouteWithContext<{ queryClient }>()` carries the QueryClient; a **pathless `_app` layout route** (`routes/_app/route.tsx`, underscore, **not** a `(app)` parens group — parens are organizational only) guards its subtree:
  ```ts
  beforeLoad: async ({ context, location }) => {
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions)
    if (!session) throw redirect({ to: '/sign-in', search: { redirect: safeRelative(location) } })
  }
  ```
  `__root` stays public (wraps marketing + auth pages). The guard is **UX-only** — every endpoint IDOR-scopes independently, so a bypass leaks nothing.
- **Session = TanStack Query single source of truth** (`sessionQueryOptions` → `GET /auth/session`), not Zustand (Zustand is UI-state only). `queryFn` returns `null` on 401 and **throws** on network/5xx (a blip must hit an `errorComponent`, never a false logout).
- **Auth-change (login/logout/password-change):** `await queryClient.invalidateQueries({ queryKey: ['auth'], refetchType: 'none' })` **then** `await router.invalidate({ forcePending: true })` — `forcePending` unmounts the protected subtree before the redirect resolves (a plain `router.invalidate()` leaves the component rendering + querying during logout).
- **Runtime 401 is load-bearing** — `ensureQueryData` ignores `staleTime`/returns stale cache, so `beforeLoad` can't self-heal a mid-session expiry; only the client **response interceptor** catches it: `setQueryData(['auth','session'], null)` + the `forcePending` invalidate above. **401 only** (never 403 — authorized-but-forbidden must not log out). Reserve TanStack Query `QueryCache.onError` for thrown-error telemetry only (single owner, no double invalidate).
- **Open-redirect guard:** store a **relative path** (`pathname+search+hash`), never `location.href`. Validate **on consumption** via parse + same-origin (`new URL(raw, origin)`, confirm `url.origin === location.origin`; reject `//`, `/\`, backslash, `%2f%2f`/`%5c`, control chars). `validateSearch` the `redirect` param with zod `.catch('/dashboard')`.
- **Per-route `errorComponent` + `pendingComponent` + a `notFoundComponent`** (the Firebase `**→/index.html` rewrite routes unknown paths into the SPA). Route `loader` + `ensureQueryData` for blocking data (each with a matching component `useQuery`/`useSuspenseQuery` subscription or the entry is GC'd), `useQuery` for deferred. No bare `useEffect(fetch)`.
- OAuth buttons are plain `window.location.assign('https://api.devstash.one/auth/oauth/{github,google}/start')` (justified hard cross-origin redirect); Go's callback 302s back with the cookie set.
- **F0 verify spikes:** (1) confirm `vite-plugin-csp-guard` actually hashes Start's prerendered inline script (its dehydrated-state content varies per build → hash computed in the pipeline, never hardcoded); (2) confirm intent-preload doesn't navigate a logged-out user on hover (old issue #1382 — guard with `cause === 'preload'` if it does).

### Frontend security (F0)
- **CSP (strict, build-time):** `script-src 'sha256-…' 'strict-dynamic'` via **`vite-plugin-csp-guard`** (hashes Vite's inline bootstrap + Start's `/` hydration script → no `'unsafe-inline'`, no path-scoped Firebase header, no header-ordering footgun). Plus `default-src 'self'; connect-src 'self' https://api.devstash.one; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`. `img-src` gains the exact S3/CDN origin only when F2 renders `file`/`image` items. (A build-time nonce is worthless on a static CDN — hashes are the mechanism.)
- **Headers:** `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` (old-client fallback for `frame-ancestors`), `Cross-Origin-Opener-Policy: same-origin` (safe — OAuth is full-page redirect, not popup), `Permissions-Policy` as an **explicit deny-list** (`camera=(), microphone=(), geolocation=(), payment=(), usb=()`, …), and **Trusted Types** (`require-trusted-types-for 'script'`) **report-only first**, enforce after confirming no library DOM-sink breakage. Vite `build.modulePreload.polyfill: false`. **Do NOT** add COEP/CORP (would break F2 cross-origin images).

### Hosting & CI
- **Firebase Hosting (classic)**, on the existing `devstash` GCP project (`<NEON_PROJECT_ID>`) — same billing/IAM as Cloud Run, free Spark tier, global CDN. Escape hatch if Spark transfer is exceeded: repoint DNS to Cloudflare Pages (migration is just DNS).
- **Standalone `beta.devstash.one`; Vercel is never in the SPA's request path** (no rewrites/proxy). The SPA calls Cloud Run directly (cross-origin) and only ever talks to Go — so an F2 page ships **only after its data domain is on Go**. `web/firebase.json`: `public: "dist"` + rewrite `** → /index.html`.
- **CORS:** backend sends `Access-Control-Allow-Credentials: true` + `ALLOWED_ORIGINS` (`https://beta.devstash.one` in transition → `https://devstash.one` after cutover). Documented fallback that voids CORS: Firebase `rewrite` `/api/**` → the Cloud Run service (same-origin) — not adopted.
- **CI:** a `web/**`-scoped Cloud Build trigger (`envs/prod` `module "web_cloudbuild_trigger"`, not a GitHub Action): `npm ci` → `npm run build` (Node 24 via `mirror.gcr.io/library/node:24`) → deploy via Google's official `us-docker.pkg.dev/firebase-cli/us/firebase` image, auth = trigger SA **ADC via the CB metadata server**. Runs as least-priv **`devstash-web-deployer`** (`firebasehosting.admin` + `serviceusage.apiKeysViewer`), built from the shared `modules/cloudbuild-deployer-sa` submodule (the backend `devstash-backend-deployer` is the sibling). Backend build is a single **`ko build`** step (`backend/.ko.yaml`, distroless, no Dockerfile/daemon); Dockerfile kept as a deprecated fallback. ⚠ ko pipeline unverified against a real Cloud Build run.

### Testing (Go-native, all phases)
- Stdlib `testing`, table-driven (`t.Run` per case, `t.Parallel()`, `t.Cleanup()`). Assertions: stdlib + `google/go-cmp` (`cmpopts.IgnoreFields` for generated cols, `EquateApproxTime` for timestamps). No Ginkgo/testify.
- **In-memory fakes by default** (hand-written, map-backed, in-package), gomock **only** at external boundaries (OAuth exchange, Resend, S3) where call sequence/arity is under test.
- Handler tests via Huma `humatest` (in-process). Time/concurrency via `testing/synctest` (`synctest.Test`, Go 1.25). Real-SQL integration via `testcontainers-go` Postgres (`postgres:17-alpine` + `WithSnapshot`/`Restore`, pgx driver) — **never** the shared Neon `dev` branch. Benchmarks via `testing.B.Loop`.
- **Coverage gated in CI** (`backend/.testcoverage.yml`): total **70%**, `internal/auth` **85%** (per-file). Generated code excluded.

## Progress detail (shipped)

- **Phase 0** — Huma v2 on `net/http` (`humago` + hand-rolled RequestID/Recover middleware), `GET /health` + SwaggerUI. Cloud Run auto-deploy (scale-to-zero, `api.devstash.one`), distroless static image, defaults to `serve` on bare launch. goose baseline marked already-applied on Neon `dev`.
- **Phase 1** — `POST /auth/login` (+cookie), `GET /auth/session`, `POST /auth/logout`; all 6 credential flows (register/verify-email/resend/forgot/reset/confirm-login-email, enumeration-safe, Redis one-time tokens via GETDEL + compare-and-delete Lua, Resend email behind an `Emailer` interface); OAuth github/google (start/callback all-302, pending-link account conflict, `POST /auth/link`). Files by flow in `internal/auth`. Gates: lint 0, race pass, `internal/auth` ≥85% per-file, total 92.2%.
- **Phase 2** — `internal/{items(9),collections(5),search(1)}` + sqlc in `db/queries/{items,collections,search}.sql`. Reproduces: three 403 branches on `POST /items` (Pro-only type, `FREE_TIER_ITEM_LIMIT=50`, invalid file reference — S3 deferred to Phase 3 so `file`/`image` create is a 403 for now), `FREE_TIER_COLLECTION_LIMIT=3`; `isPro` read-only from `isPro && stripeSubscriptionId != nil` (no Stripe call); two-sided retype guard + language remap; cursor pagination (`{isPinned,createdAt,id}` desc, favorites `{updatedAt,id}`, `ITEMS_PAGE_SIZE=20`); discriminated-union `GET /items` query; `ILIKE`-substring search (items ≤20, collections ≤10) with `\ % _` escaping; collection PATCH description-presence via `description_set`. Uniform-superset `LightItem` (additive) is the one shape change; strict payload parity otherwise (drift-guards stay green — API-shape redesign deferred to the Frontend Track). Constants mirrored as Go consts (`TEXT_ITEM_TYPE_NAMES={snippet,prompt,command,note}`, `ITEM_TYPES_WITH_URL={link}`, `ITEM_TYPES_WITH_FILE={image,file}`, `PRO_ITEM_TYPE_NAMES={file,image}`, `ITEM_DESCRIPTION_MAX_CHARS=2000`, …).

## Frontend F1–F3 scope (specs; stack + security above)

- **F1 — auth pages** (first, self-contained, proves the SPA↔Go loop): `web/src/routes/(auth)/` = `sign-in`, `register`, `forgot-password`, `reset-password`, `verify-email`, `link-account`, each driving its Phase-1 endpoint. `link-account` consumes the pending-link `token` + password re-check → `POST /auth/link`.
- **F2 — `_app` protected subtree** (largest; ships page-by-page, **hard-sequenced** after each page's backend phase): `dashboard`, `/items/[type]`, `/collections/[id]`, `/favorites` after Phase 2; `/profile` after Phase 4; `/settings` (billing) after Phase 5. Un-migrated pages stay on old Vercel until then.
- **F3 — marketing homepage** (last, only route needing SEO): `web/src/routes/index.tsx`. **Per-route static prerender of `/` only** via the Start plugin `pages: [{ path: '/', prerender: { enabled: true, outputPath: '/index.html' } }]` (SPA mode alone prerenders only the shell = empty fallback for crawlers). Keep the **root route free of request-specific loader work** (the shell prerender runs root loaders at build time). Verify `/` renders correctly with JS disabled.

## Later backend phases (not yet planned in detail)

- **Phase 3** — file/image upload/download (S3 presign + Redis pending-upload consume; unblocks the `file`/`image` 403 and DELETE blob cleanup).
- **Phase 4** — profile (unblocks F2 `/profile`; incl. the deferred signed-in "Add account" link-intent flow).
- **Phase 5** — Stripe/billing writes + subscription management (unblocks F2 `/settings`).
- **Phase 6** — AI Brain-dump (`ai_parse_job_items`) + realtime (credentialed `EventSource` across subdomains).

## Remaining / cutover

- **Phase 1 cutover:** add Go's callback URIs to the GitHub/Google OAuth app allowlists + set `AUTH_GITHUB_*`/`AUTH_GOOGLE_*`/`API_BASE_URL` in prod `APP_CONFIG`; apply the `__Host-` cookie rename + API HSTS header; delete `src/app/api/auth/**` + `src/auth.ts`/`src/lib/auth/**`/`src/lib/session.ts` + `src/actions/auth/*`; Vercel edge rewrite for the auth prefix → `api.devstash.one`.
- **Phase 2 cutover:** delete `src/app/api/{items,collections,search}/**` + their Vitest tests; Vercel edge rewrite `/api/{items,collections,search}/*` → `api.devstash.one`.
- **F0 external:** add Firebase DNS records for `beta.devstash.one` (Spaceship CNAME/A); add `https://beta.devstash.one` to `ALLOWED_ORIGINS`; delete `src/middleware.ts`.
- **Final cutover (post-F3 + Phase 6):** repoint apex `devstash.one` DNS Vercel→Firebase (two A records + TXT), delete the Vercel project, retire `beta.`.

## Files to touch (F0, next up)
- `web/src/routes/__root.tsx` (public `createRootRouteWithContext<{ queryClient }>()`), `web/src/routes/_app/route.tsx` (pathless guard), `web/src/router.tsx` + `web/vite.config.ts` (router instance + Start/Router Vite plugin `autoCodeSplitting` + dev proxy + `vite-plugin-csp-guard`).
- `web/src/auth/` (`sessionQueryOptions`, `safeRelative` redirect guard, auth-change invalidation), `web/src/lib/api/client.ts` (Hey API client + 401 response interceptor).
- `web/firebase.json` (hosting + headers/CSP), `web/.firebaserc` (pins `devstash`).

## Constraints (evergreen)
- **Never** `prisma db push`; Prisma frozen (`prisma migrate dev` only if something is still Prisma-side); goose owns all new schema.
- **Never** touch the Neon production branch; always use `dev` for MCP ops.
- `backend/` is 100% Go — no `package.json`/npm/Node tooling.
- Vertical slices (one file per op), narrow consumer-defined store interfaces (not a global `Querier`), in-memory fakes by default. No `authedRoute`/`publicRoute` wrappers (use Huma `Operation.Security`), no hand-rolled `problem()`/`json()`/`parseOr422` (Huma RFC 9457).
- IDOR: every sqlc query scoped by session `userId`, never user input; `security_guard_test.go` default-deny stays green.
- Reproduce `""`→`null` coercion (`description`/`content`/`url`/`language`, collection `description`); `tags`/`collectionIds` default `[]`; URL must be `http(s)://` or empty.

## Out of scope
- Encore.dev, an identity server (Zitadel/Kratos), and the legacy NextAuth JWE decode (forced re-login instead).
- Any Node dependency inside `backend/`; `tailwind.config.ts` (Tailwind v4 CSS config carries to `web/`).
- Schema changes to Neon during the transition; moving `infra/` GKE to production (stays a $0-idle learning sandbox).
- `backend/exercise/` — an independent Go learning course, not DevStash; never reviewed/edited.
