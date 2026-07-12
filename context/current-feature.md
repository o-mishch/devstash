# Current Feature: Backend → Go + Frontend → Vite SPA (Full Rewrite)

## Status
In Progress — **Phase 0 ✅ complete** (Go service live at https://api.devstash.one/health on Cloud Run). **Active: Phase 1 — Auth/session foundation** (blocks both tracks; Frontend F0 starts once it ships).

> Deploy target note: the original plan doc names Northflank; the shipped Phase 0 deploys to **Google Cloud Run** (Dockerfile build via Cloud Build, distroless static image, scale-to-zero, `api.devstash.one`). Cloud Run is authoritative for this feature.

## Goals

### Structural / repo-wide (all phases)
- `backend/` directory exists at repo root with a Go module (`go.mod`), a single Cobra binary (`cmd/api/main.go`) with `serve`, `migrate`, and `openapi` subcommands, and zero `package.json`/Node files anywhere inside it
- `web/` directory exists at repo root as a Vite + TanStack Router SPA; `openapi-typescript` runs only inside `web/`, not in `backend/`
- A root `Taskfile.yml` exists with a `task dev` command that starts both `air` (Go hot-reload) and `vite dev` concurrently via sub-Taskfiles
- `src/app/api/` route handlers are deleted domain-by-domain as each Backend Track phase completes; `src/app/(auth)/`, `(app)/`, `(marketing)/` pages deleted as each Frontend Track phase completes; `src/` is fully deleted when Phase 6 + F3 finish
- `prisma/schema.prisma` and `prisma/migrations/` are frozen (no new changes) from Phase 0 onward; goose owns all schema migrations from `backend/db/migrations/`

### Phase 0 — Go skeleton + CI/deploy scaffolding ✅ COMPLETE
- ✅ `backend/` contains a working Go module with Huma v2 on `net/http` (chi router via `humachi`, kept for its middleware ecosystem — request-id, recovery, real-ip), serving `GET /health` (200) and SwaggerUI at `/docs`
- `golangci-lint` and `go test ./...` run in CI (`.github/workflows/`) for the `backend/` tree
- Google Cloud Run auto-deploy is connected to `backend/` (**Dockerfile** build via Cloud Build; scale-to-zero / `min-instances=0`; `api.devstash.one` custom domain, `/health` probe); the service returns 200 at `/health`. Runtime image is a static Go binary on `gcr.io/distroless/static-debian12:nonroot` (ships CA certs, tzdata, and a nonroot user; no shell/package manager). The binary still defaults to `serve` on bare launch (robustness); goose migrations are embedded so the image ships no loose files.
- A goose baseline migration exists at `backend/db/migrations/` representing the current Neon schema as-applied, marked as already-applied against the Neon `dev` branch (not replayed)
- `backend/internal/config/` contains a `caarlos0/env` config struct with struct tags matching existing `.env` variable names (no renames); Go service loads from the shared repo-root `.env`/`.env.local` via `godotenv`

### Phase 1 — Auth/session foundation (blocks both tracks) ← ACTIVE

**Progress (branch `feature/phase-1-auth-session`, uncommitted):**

✅ **Core auth slice** — the Frontend-F0 unblocker: `POST /auth/login` (204 + cookie), `GET /auth/session` (secured), `POST /auth/logout`; session envelope (Redis `goredisstore`, fingerprint-rotation + idle + deleted-user + transient-DB-preserve checks); `Operation.Security` Huma middleware; `redis_rate` limiter (all 11 buckets); bcrypt credential validation (dummy-hash constant-time).

✅ **Email/password surface** — all 6 credential flows: `POST /auth/register` (200 redirect, enumeration-safe), `POST /auth/verify-email` (204), `POST /auth/resend-verification` (204, anti-spam), `POST /auth/forgot-password` (200), `POST /auth/reset-password` (204, prior-state branches), `POST /auth/confirm-login-email` (204/409/422 add-vs-change). Redis one-time tokens (`tokens.go`: verify/reset GETDEL + credential-email gen-check Lua), Resend email (`internal/email`, behind `auth.Emailer` + `Noop`), sqlc write queries, UUIDv7 ids.

✅ **Native-Go review & hardening pass (2026-07-12)** — critical review of the whole `backend/` tree against modern Go idiom (verdict: idiomatic, not a Next transliteration). Five findings actioned:
1. **X-Forwarded-For client IP (security)** — `clientIP` took the *leftmost* XFF entry (a straight port of the Vercel-era Next `getActionIP`); on Cloud Run the leftmost value is attacker-controlled, so an attacker could rotate it to defeat every per-IP rate-limit bucket. Rewritten to trust from the **right**: `clientIP(xff, trustedHops)` indexes `len-1-trustedHops` (rightmost = real client on Cloud Run's direct domain mapping). New `TRUSTED_PROXY_DEPTH` config (default 0; bump to 1 behind a Global ALB). The one intentional break from Next parity.
2. **Unused `required` config** — `AUTH_SECRET` (unread since the JWE-decode drop) and the four OAuth vars (`AUTH_GITHUB_*`/`AUTH_GOOGLE_*`, OAuth not built yet) were `,required`, so the service refused to boot without secrets no code reads. Relaxed to optional; only `DATABASE_URL` + `REDIS_URL` are truly required now.
3. **`Deps`→`Service` refactor** — the deps-bag-with-value-receiver-methods became an unexported-field `Service` with `New(Deps) *Service` and pointer methods (`Deps` stays as the exported constructor input; `Register(api, Deps)` unchanged). Sets the template before OAuth/items/collections copy it.
4. **Session envelope** — `lastActiveAt` stored as a Unix `int64` instead of `time.Time`, removing the `gob.Register(time.Time{})` hack (every scs claim is now a gob built-in).
5. **CSRF Origin allowlist** — new `middleware.RequireTrustedOrigin` (net/http, outermost): rejects state-changing requests whose browser `Origin` isn't on `ALLOWED_ORIGINS` (transport-aware — absent Origin = non-browser/Bearer passes; empty allowlist disables in dev). Primary CSRF control alongside the `SameSite=Lax` cookie; reused by F0 CORS via `middleware.AllowedOrigin`.
Plus polish: `genericErrorMessage` const for the repeated 500 body; stale JWE comment removed from `.testcoverage.yml`.

Gates green: golangci-lint **0 issues**, `go test -race` **pass**, `internal/auth` **≥85%** (gate PASS — the override is enforced **per-file**, so every auth file individually clears 85%, not just the package aggregate), total **90.2%** (≥70). Decisions this phase: sessions→Redis (reversed), UUIDv7 ids, Resend SDK, XFF rightmost-trusted, `Service` pattern, CSRF via stdlib `net/http.CrossOriginProtection` + `rs/cors` (both keyed on `ALLOWED_ORIGINS`).

> **Review follow-up (2026-07-12):** a `/feature review` caught the per-file auth coverage gate red — `password.go` (82.1%), `tokens.go` (83.0%), `register.go` (84.6%) had each drifted below 85% after the crossorigin/clientip refactor added uncovered lines (total was still fine at 85.9%, masking it). Fixed by adding targeted error-path tests (forgot-password lookup-failure stays 200; reset-password short-password 422 + hard-DB-error 500; register blank-name 422; resend-verification DB-error 500; credential-token corrupt-blob + unknown-token paths). All three files now clear 85% (86.3/86.4/88.0%); gate exit 0.

> **Review follow-up #2 (2026-07-12):** a second `/feature review` (post chi→humago router refactor + logging-context/reqid additions) caught the per-file auth gate red *again* — `password.go` (81.2%) and `register.go` (84.0%) had re-drifted below 85% as both grew new uncovered error legs, while total (85.4%) masked it as before. Fixed with a dedicated `internal/auth/errorpath_test.go` batch (reset-password write/consume/notify legs; confirm-login-email transient-lookup + password-required + restore-failure legs; verify-email rate-limit/consume/mark-verified 500s; register nudge-mint + insert-hard-error + credential-email lookup legs; forgot-password send legs; direct `applyPasswordReset`/`addCredentialEmail` hash-error calls that bypass the 72-char handler cap; `isHumaStatus`/`ignoreUnique` unit pins), plus new fake error knobs (`fakeUserStore`: `insertErr`/`pwWriteErr`/`markVerifiedErr`; `fakeTokens`: `verifyConsumeErr`/`resetConsumeErr`/`recentSentErr`/`restoreErr`). Now password.go **99.2%**, register.go **95.4%**; `tokens.go` also lifted 85.1%→**87.8%** for margin (it was clearing by 0.1%). Gate exit 0, total **90.2%**.

**Remaining (not yet built):** OAuth github/google (start/callback as Huma 302 ops, `x/oauth2`), account-linking + Redis pending-link, `getUserWithOAuthConflict`/`createAccount` sqlc queries, and the one-time external config (add Go callback URIs to the GitHub/Google OAuth app allowlists). Then: delete `src/app/api/auth/**` + `src/auth.ts`/`src/lib/auth/**`, and the edge routing cutover.

**Session model — DECIDED 2026-07-11 (supersedes the plan doc; scope reviewed against native-Go idiom):**
- **Composed Go libraries, no identity server.** `alexedwards/scs` (sessions) + `golang.org/x/oauth2` (OAuth) + `golang.org/x/crypto/bcrypt` (reads existing `bcryptjs` hashes as-is) + `redis/go-redis/v9` (sessions, tokens, rate-limit). Reaffirmed over Zitadel/Kratos/Authboss — thin idiomatic glue, reuses `users`/`accounts`, $0 extra infra, matches the plan's "learn idiomatic Go, not a platform" goal.
- **Unified web + mobile backend, one opaque stateful session** (Model A). One opaque token per session stored in **Redis via `scs/goredisstore`** (keys `scs:session:<token>`) — **REVERSED 2026-07-11 from the original Postgres/pgxstore + goose `sessions` table** plan. Session load is on the hot path of every authenticated request; Neon is connection-limited (PgBouncer, scale-to-zero), so keeping session reads off it avoids latency and pool pressure. Auth already hard-depends on Redis (login rate-limit, one-time tokens), so DB sessions "surviving a Redis outage" buys ~nothing here. Redis gives native TTL expiry (no cleanup goroutine), instant `DEL` revocation, and `goredisstore` reuses the same `go-redis/v9` client the rest of Phase 1 needs (zero new dep). The NextAuth `sessions` table is simply abandoned (forced re-login) — no goose migration touches it. `users`/`accounts` reused unchanged. Session-fixation protection via `scs.RenewToken` on login/logout. **Redis transport is provider-agnostic** (`REDIS_URL` via `redis.ParseURL`: prod Cloud Run → Upstash `rediss://` auto-TLS; GKE sandbox → Memorystore `redis://` over private VPC IP, encryption off; local/CI → native/testcontainers `redis://`); go-redis never knows the provider (see `internal/redisconn`). Memorystore-with-encryption would need `TLSConfig.RootCAs` from a future `REDIS_CA_CERT` — not implemented (not needed yet).
- **Transport-agnostic resolution; cookie now, Bearer-ready without inert code.** Session lookup is a `token → userID` function that takes a **token string, not `*http.Request`** — so web (httpOnly cookie: `Domain=.devstash.one`, `SameSite=Lax`, `Secure`) is wired now, and a `Authorization: Bearer` extractor is a ~10-line add for mobile later (hand-rolled in the Huma middleware — no `go-chi/jwtauth` dep, since our middleware is Huma-native not chi-native). scs itself supports header/body token transport, so no store change is needed for mobile. **No inert Bearer code ships now** (only-implement-what's-specified).
- **No legacy NextAuth JWE decode shim.** Force a **one-time re-login** at web cutover (web auth is majorly changing NextJS→React anyway). `go-jose`+HKDF decode is **dropped** — removes the highest-risk Phase 1 surface + the `AUTH_SECRET`-for-decode dependency + `__Secure-` salt / chunked-cookie edge cases. (Spike 2026-07-11 confirmed the decode *works* — the choice is product, not technical.)
- **Every route is a Huma operation** (uniform OpenAPI coverage — no raw net/http handlers). OAuth redirects fit Huma via `DefaultStatus: 302` + `Location`/`Set-Cookie` output-header fields + `query:`/`cookie:` input tags. Auth middleware is Huma `Operation.Security`-driven.
- **Cohesive files by flow, NOT file-per-operation** (the plan's file-per-op rule is a NextJS route-file carryover; it stays for later independent CRUD domains like items, but auth's coupled flows group by cohesion).
- `GET /auth/session` endpoint returns the current user or 401 — the SPA's client-side auth check.

**Parity inventory (read end-to-end, then port operation-by-operation, then delete):**
- **Route handlers → Go operations** (`src/app/api/auth/`): `login`, `register`, `forgot-password`, `reset-password`, `resend-verification`, `confirm-login-email`, and `[...nextauth]` (OAuth start/callback + NextAuth session). Each becomes a vertical-slice file in `backend/internal/auth/` (`login.go`, `register.go`, `oauth.go`, …).
- **Core auth logic → Go** (read for parity, then delete): `src/auth.ts` (session envelope: `SESSION_MAX_AGE=24h`, `SESSION_UPDATE_AGE=60s` re-persist/`lastActiveAt` granularity, `classifyPasswordFingerprint` password-rotation invalidation, transient-DB-error session preservation — all reproduce on the scs session, not a JWT), `src/lib/session.ts`, `src/lib/auth/auth-service.ts` (`validateUserPassword` via `golang.org/x/crypto/bcrypt` reading existing `bcryptjs` hashes as-is, `assertCredentialLoginAllowed`), `src/lib/auth/session-idle.ts` (`applySessionActivity` idle timeout), `src/lib/auth/tokens.ts` (Redis atomic-consume Lua for credential-email + reset tokens), `src/lib/auth/pending-link.ts` (`createPendingLink`/`getLinkIntent`/`consumeLinkIntent` — Redis-backed OAuth account-linking).
- **NOT ported**: legacy NextAuth v5 JWE cookie decode (`src/auth.ts` JWE path) — dropped per the forced-re-login decision above.
- **Server actions that CEASE TO EXIST (not ported)**: `src/actions/auth/login.ts`, `src/actions/auth/link.ts` — OAuth start becomes plain SPA navigation (`window.location.assign`) to Go's OAuth start endpoint; Go's callback 302s back with the cookie set.
- **sqlc queries**: extend `backend/db/queries/auth.sql` (today only `GetUserByID`/`GetUserByEmail`) to cover register-insert, account read/write/link, session CRUD, and OAuth-conflict lookup — every query scoped by session `userId`, never user input (IDOR).
- **Coverage gate**: `internal/auth` held to **85%** in `backend/.testcoverage.yml` (highest-risk surface).

**Phase 1 risks to verify:**
- Cross-subdomain cookie/CORS: confirm `Access-Control-Allow-Credentials: true` + explicit origin allowlist (not `*`) so the `Domain=.devstash.one` cookie works from the SPA origin; and credentialed `EventSource` across subdomains (Phase 6).
- Dual-transport middleware: session resolution must accept cookie OR `Authorization: Bearer` from one code path, and must NOT set/expect a cookie on Bearer (mobile) requests. Keep the Bearer branch inert-but-present now so mobile drops in without reworking the middleware. CSRF posture differs per transport (cookie needs it, Bearer doesn't) — design the check to key off transport.
- Redis Lua atomic-consume (`CONSUME_CREDENTIAL_EMAIL_IF_CURRENT`, `GETDEL` pending-link) ports via go-redis `Eval`/`GetDel` — needs an explicit concurrency test (`testing/synctest`) for identical race behavior.
- One-time external config: add Go's callback URIs (`https://api.devstash.one/auth/oauth/{github,google}/callback`) to the GitHub/Google OAuth app redirect allowlists.
- ~~Legacy JWE decode key-derivation exactness~~ — **removed** (shim dropped; forced re-login).

### Frontend Track F0 (depends on Phase 1)
- `web/` is a Vite + TanStack Router + TanStack Query + Zustand project; `vite.config.ts` proxies `/api/*` to the local Go server
- A root layout in `web/src/` contains a client-side auth guard that calls `GET /auth/session`; protected routes 401-redirect to sign-in; `src/middleware.ts` (Next.js) is deleted once F0 ships

**Frontend hosting — DECIDED 2026-07-12 (supersedes the plan doc's "Vercel (or Cloudflare Pages)"):**
- **Firebase Hosting (classic), GCP-native.** The prod SPA is a static Vite build deployed to **Firebase Hosting** attached to the existing `devstash` GCP project (`wandering-lab-34213896`) — same project/billing/IAM as the Cloud Run backend. Global CDN + managed SSL + no cold start, all on the free **Spark** tier (10 GB storage, ~360 MB/day ≈ ~10 GB/mo transfer). Chosen over a **second Cloud Run** (wrong tool for static: scale-to-zero cold starts on a public landing page, no built-in CDN → would need Cloud CDN + external HTTPS LB whose forwarding rule is ~$18/mo, breaking "free") and over **Cloudflare Pages** (objectively strongest free static host — truly unlimited bandwidth — but a second vendor and clean apex needs DNS on Cloudflare). Firebase App Hosting is the Cloud-Run-backed SSR product; classic Hosting remains the officially recommended path for a pure SPA. **Escape hatch if Spark's ~10 GB/mo transfer is exceeded: repoint DNS to Cloudflare Pages — migration is just DNS.**
- **Transition = subdomain; apex stays on Vercel until full cutover.** The live prod apex `devstash.one` remains linked to the **current Vercel deployment for the entire migration** — the Firebase SPA is linked to a **transition subdomain, `beta.devstash.one`** (retired at final cutover). Subdomains use CNAME (or A) records, which Spaceship handles fine — the CNAME-flattening limit is apex-only, and the apex isn't touched until the end. `api.devstash.one` stays on Cloud Run. **At final cutover** (post-F3 + Phase 6): repoint the apex DNS from Vercel to Firebase (**two A records** + TXT verify — apex-via-A dodges CNAME-flattening), delete the Vercel project, and retire/redirect the transition subdomain. The `web/firebase.json` `rewrites: [{ source: "**", destination: "/index.html" }]` makes TanStack Router client-side routing work (unknown paths → `index.html`, not 404); `public: "dist"` matches Vite's build output.
- **This resolves the routing seam — the plan's §3 stays intact.** Because Vercel keeps the apex, **Vercel remains the edge router**, and Vercel `rewrites` *can* target external URLs: unmigrated pages → its own Next.js; migrated page prefixes → `https://beta.devstash.one` (Firebase); migrated `/api/*` → `https://api.devstash.one` (Cloud Run). Firebase never has to proxy the Vercel remnant (which it can't — Firebase rewrites only hit `destination`/Cloud Run/Cloud Functions); it just needs to be reachable at the subdomain as a rewrite target. The earlier "apex can't sit on Firebase and fall back to Vercel" wrinkle is moot: the apex doesn't move to Firebase until there's nothing left to fall back to.
- **Cross-origin posture retained (SPA subdomain ↔ API `api.` subdomain).** Keeps the Phase 1 cross-subdomain cookie/CORS design as-is: backend sends `Access-Control-Allow-Credentials: true` + an explicit origin allowlist (add **`https://beta.devstash.one`** during transition, `https://devstash.one` after cutover — never `*`), session cookie `Domain=.devstash.one; SameSite=Lax; Secure` (both hosts share the registrable domain → `Lax` cookies flow across the SPA subdomain and `api.`). **Documented fallback:** Firebase Hosting can `rewrite` `/api/**` straight to the Cloud Run service (`"run": { "serviceId", "region" }`), collapsing to same-origin and voiding CORS entirely — not adopted now, but the one option that can neutralize the CORS risk.
- **Dev vs prod origin:** dev is same-origin via the Vite `/api/*` proxy (no CORS locally); prod's openapi-fetch client hits `https://api.devstash.one` directly with `credentials: 'include'` (baseUrl differs by env).
- **CI:** a GitHub Action separate from the backend's Cloud Build pipeline — on push to `main` touching `web/**`: `npm ci && npm run build && firebase deploy --only hosting` (auth via Firebase CI token / Workload Identity). Per-PR preview channels (`firebase hosting:channel:deploy`) available for free.

### Per-phase backend cutover pattern (Phases 2–6)
- Each backend phase: Go handlers in `backend/internal/<domain>/` pass parity tests (table-driven with `t.Run` subtests, against narrow consumer-defined interfaces backed by **in-memory fakes** — see the Testing constraints); the corresponding `src/app/api/<domain>/` route handlers and Vitest test files are deleted in the same PR; edge routing rule updated to point that domain's prefix at `api.devstash.one`

### Testing approach (Go-native, all phases)
- **Standard library `testing` is the frame** — table-driven cases in a slice of structs, one `t.Run(tc.name, …)` per case, `t.Parallel()` on independent cases, `t.Cleanup()` over manual teardown. No test framework layered on top (no Ginkgo/Convey).
- **Assertions: stdlib + `google/go-cmp`.** Scalars via `if got != want { t.Errorf(...) }` / `t.Fatal` on setup errors; structs, slices, and maps via `cmp.Diff(want, got)` (readable field-level diff). Use `cmpopts.IgnoreFields` for generated columns (ids, `createdAt`/`updatedAt`) and `cmpopts.EquateApproxTime` for timestamps. No `stretchr/testify` (avoids a second, competing assertion idiom).
- **Test doubles: in-memory fakes by default, gomock only at external boundaries.** Each domain's narrow, consumer-defined interface gets a hand-written fake (small struct with a `map` backing) living in the test package — this is the default for the sqlc data layer and doubles as handler-test scaffolding. Reserve generated gomock mocks for interfaces wrapping collaborators we don't own where call sequence/arity is the thing under test (OAuth token exchange for GitHub/Google, Resend email, S3).
- **Handler tests go through Huma's `humatest`** — `_, api := humatest.New(t)`, register routes, `api.Get`/`api.Post(...)`, assert `resp.Code` and `resp.Body.String()`. In-process, no real socket.
- **Concurrency/time: `testing/synctest`** (stable in Go 1.25 — use `synctest.Test`, not the 1.24 experimental `synctest.Run`) for anything time-dependent: session expiry, OAuth callback deadlines, rate-limit windows. Virtual time, deterministic, no `time.Sleep` in tests.
- **Integration tests that exercise real SQL: `testcontainers-go` Postgres**, never the shared Neon `dev` branch. `postgres.Run(ctx, "postgres:17-alpine", …)` per run with `t.Cleanup(...)` for teardown; use `postgres.WithSnapshot()` + `container.Restore(ctx)` (import the `pgx` stdlib driver so snapshot/restore uses the native driver, not `docker exec`) for a clean DB per case. Keeps the "never mutate Neon during transition" constraint clean and stays parallel-safe.
- **Benchmarks (if any) use `testing.B.Loop`** (Go 1.24+), not the legacy `for i := 0; i < b.N` idiom — auto-excludes setup timing and defeats dead-code elimination. (`b.Loop` is a sanctioned exception to the "no classic for loops" rule in `go-coding-standards.md`.)
- **Coverage is gated in CI (hard-fail).** `backend-ci.yml` Test step emits a profile (`go test -race -covermode=atomic -coverpkg=./... -coverprofile=cover.out ./...`) and `vladopajic/go-test-coverage` (pinned action) enforces `backend/.testcoverage.yml`: **total 70%**, with `internal/auth` held to **85%** (highest-risk surface). Generated code is excluded (sqlc `internal/db`/`*.sql.go`, mockgen `*_mock.go`/`/mocks/`). No SaaS/token — in-repo, matches the `contents: read`-only CI posture.

## Notes

- **Files to touch (Phase 0):**
  - `backend/` — new directory, entire Go module (does not exist yet)
  - `backend/cmd/api/main.go` — Cobra root + subcommands
  - `backend/internal/config/config.go` — caarlos0/env struct
  - `backend/db/migrations/` — goose baseline SQL
  - `backend/Dockerfile` — Cloud Run build via Cloud Build (build context `/backend`)
  - `backend/db/embed.go` — embeds goose migrations into the binary (self-contained; runtime image ships no loose files)
  - `backend/Taskfile.yml` — `air` dev task
  - `web/Taskfile.yml` — `vite dev` task (created alongside F0)
  - `Taskfile.yml` (root) — `task dev` orchestration
  - `.github/workflows/` — add Go lint/test job
  - `infra/` — extend GKE sandbox manifests for Go service (learning-only, no prod impact)

- **Files to touch (Phase 1)** — cohesive files by flow (not one-per-endpoint):
  - `backend/internal/auth/login.go` — login (credentials) + `GET /auth/session` + logout (session issue/renew/revoke via scs)
  - `backend/internal/auth/register.go` — register + email verification + resend-verification (one signup flow)
  - `backend/internal/auth/password.go` — forgot-password + reset-password (one recovery flow) + confirm-login-email
  - `backend/internal/auth/oauth.go` — GitHub + Google start/callback as Huma ops (`DefaultStatus: 302` + `Location`/`Set-Cookie`); account-linking via Redis pending-link token
  - `backend/internal/auth/tokens.go` — Redis one-time tokens (verify/reset/pending-link): `GETDEL` for simple consume, Lua only for compare-and-delete
  - `backend/internal/middleware/auth.go` — Huma `Operation.Security`-driven session resolution; transport-agnostic `token→userID` (cookie now, Bearer add later)
  - `backend/internal/session/session.go` — scs + **goredisstore (Redis)** wiring + session-envelope claim accessors
  - `backend/internal/redisconn/redisconn.go` — shared provider-agnostic go-redis client (`REDIS_URL` via `ParseURL`); mirrors `internal/postgres`
  - (no goose migration for sessions — Redis-backed; NextAuth `sessions` table abandoned in place)
  - `backend/db/queries/auth.sql` + generated sqlc output (extend beyond current `GetUserByID`/`GetUserByEmail`: register-insert, account read/link, OAuth-conflict lookup — all scoped by session `userId`)
  - `src/app/api/auth/` — deleted once Go auth passes
  - `src/auth.ts`, `src/lib/session.ts`, `src/lib/auth/*.ts` — read for parity, then deleted (JWE decode path NOT ported)
  - Deps to add: `alexedwards/scs/v2` (+ `scs/goredisstore`), `golang.org/x/oauth2`, `golang.org/x/crypto/bcrypt`, `redis/go-redis/v9`. **No `scs/pgxstore` (Redis store instead), no `go-jose`, no `crypto/hkdf`, no `go-chi/jwtauth`.**

- **Files to touch (Frontend F0):**
  - `web/src/routes/__root.tsx` — root layout + auth guard
  - `web/src/auth/guard.tsx` — session-check logic
  - `web/src/lib/api/client.ts` — openapi-fetch client (`baseUrl` = `/api` in dev via proxy, `https://api.devstash.one` in prod, `credentials: 'include'`)
  - `web/vite.config.ts` — proxy config
  - `web/firebase.json` — Firebase Hosting config (`public: "dist"` + SPA rewrite `** → /index.html`)
  - `.firebaserc` — pins the `devstash` GCP project
  - `.github/workflows/` — add a `web/**` deploy job (`firebase deploy --only hosting`), separate from backend Cloud Build
  - `src/middleware.ts` — deleted after F0
  - (external, F0) add Firebase's TXT + record(s) to Spaceship DNS for the transition subdomain `beta.devstash.one`; add `https://beta.devstash.one` to Vercel's page/API edge rewrites and Go's CORS allowlist
  - (external, final cutover) repoint apex `devstash.one` DNS from Vercel to Firebase (two A records + TXT), delete Vercel, retire the transition subdomain

- **Utilities to reuse:**
  - Existing `.env` variable names (no renames — Go uses same keys via caarlos0/env)
  - `openapi.json` (existing) as merge input for Go's `api openapi merge` subcommand during transition
  - `src/lib/db/*.ts` files — read end-to-end per phase for sqlc query parity (one sqlc query per exported function, same order)
  - `src/app/api/` route handlers — read for Go handler parity before deletion

- **Out of scope:**
  - Encore.dev (explicitly deferred — stay with Huma + composed libraries)
  - Any Node dependency inside `backend/`
  - `tailwind.config.ts` (Tailwind v4 CSS-based config carries over to `web/`)
  - Schema changes to Neon during the transition period (goose handles all schema changes from Phase 0 onward; Prisma is frozen)
  - Moving `infra/` GKE to production — it stays a $0-idle learning sandbox

- **Constraints:**
  - Never `prisma db push` — use `prisma migrate dev` for anything still Prisma-side during the strangler period; use goose for all new schema changes
  - Never touch the Neon production branch (`br-royal-poetry-ale2q4pb`)
  - `backend/` must be 100% Go — no `package.json`, no npm scripts, no Node tooling anywhere in that tree
  - Domain packages use vertical slices (one file per operation: `create.go`, `list.go`, etc.) — not a shared `service.go` per domain
  - No `authedRoute`/`publicRoute` wrapper pattern in Go — use Huma `Operation.Security` + middleware instead
  - No hand-rolled `problem()`/`json()` helpers — use Huma's native RFC 9457 error responses
  - Narrow, consumer-defined interfaces per domain package (not one global `Querier`) — back these with hand-written in-memory fakes by default; gomock only at external-service boundaries (see the Testing approach section)
  - IDOR: every sqlc query must scope by `userId` from the session, never from user input
  - `window.location.assign` for OAuth start is explicitly justified (no server-side redirect mechanism in the SPA)
  - Start with Phase 0 — do not implement Phase 1+ until Phase 0 is verified (Cloud Run `/health` returns 200)
  - `backend/db/migrations/` is a real directory owned by goose — never a symlink into `prisma/migrations/` (breaks `go:embed`, pollutes the frozen Prisma dir, and is fragile on Windows)
