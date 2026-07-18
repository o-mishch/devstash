# Migration Log — Backend → Go + Frontend → Vite SPA

The full record of the strangler migration: architecture decisions and *why* they were made, what each shipped phase actually contains, and the external cutovers still pending.

- **Current status and what's next** → `context/current-feature.md`.
- **Standing constraints** (Prisma frozen, `backend/` is 100% Go, never touch the Neon `production` branch, no cross-stack imports) → `.agents/rules/boundary.md`. They are not restated here.
- **Go backend standards** (vertical slices, validation/errors, IDOR, data access, testing) → `.agents/rules/go-coding-standards.md`. Not restated here.

## Architecture (authoritative decisions)

### Repo shape

- `backend/` — single Cobra binary (`cmd/api/main.go`) with `serve`/`migrate`/`openapi` subcommands.
- `web/` — Vite + TanStack Start SPA; `@hey-api/openapi-ts` runs only here.
- Root `Taskfile.yml` `task dev` runs `air` (Go hot-reload) + `vite dev` concurrently via sub-Taskfiles.
- `src/app/api/*` handlers deleted domain-by-domain as each backend phase cuts over; `src/` fully deleted when Phase 6 + F3 finish.
- goose migrations at `backend/db/migrations/` (a real dir, never a symlink into `prisma/`), embedded into the binary via `backend/db/embed.go`.

### Backend service model (auth/session)

- **Composed Go libs, no identity server:** `alexedwards/scs` + `scs/goredisstore`, `golang.org/x/oauth2`, `golang.org/x/crypto/bcrypt` (reads existing `bcryptjs` hashes as-is), `redis/go-redis/v9`. Reuses `users`/`accounts` unchanged.
- **Opaque stateful session in Redis** (keys `scs:session:<token>`). Session load is on every authed request's hot path; Neon is connection-limited, so sessions stay off it. Native TTL expiry, instant `DEL` revocation, `RenewToken` on login/logout for fixation. The NextAuth `sessions` table is abandoned (forced re-login — **no JWE decode shim**, the highest-risk surface dropped).
- **Session envelope reproduced on the scs session:** `SESSION_MAX_AGE=24h`, `SESSION_UPDATE_AGE=60s` re-persist granularity, password-fingerprint invalidation, idle timeout, transient-DB-error preservation. `lastActiveAt` stored as Unix `int64` (all gob built-ins).
- **Transport-agnostic resolution:** session lookup is `token → userID` (takes a token string, not `*http.Request`). Cookie is wired now; an `Authorization: Bearer` extractor is a ~10-line later add. No inert Bearer code ships now.
- **Cookie:** `__Host-session`, `SameSite=Lax`, `Secure`, **host-only** (no `Domain`; `COOKIE_DOMAIN` empty). `beta.`→`api.` is same-site (shared `devstash.one` eTLD+1), so `Lax` sends it on credentialed cross-origin XHR incl. POST/PATCH; the `__Host-` prefix gives browser-enforced host-only scope against sibling-subdomain cookie injection.
- **CSRF:** stdlib `net/http.CrossOriginProtection` (Sec-Fetch-Site + Origin/Host) + `rs/cors`, both keyed on `ALLOWED_ORIGINS`. `CrossOriginProtection` rejects `Sec-Fetch-Site: same-site` unless the origin is allowlisted → closes the sibling-subdomain gap `Lax` alone leaves open. Allowlist is load-bearing, keep it tight (never `*`). No CSRF token needed. **Never mutate state on GET.**
- **Client IP:** `clientIP(xff, trustedHops)` trusts XFF from the **right** (`TRUSTED_PROXY_DEPTH`, default 0 for Cloud Run direct; 1 behind a Global ALB) — the leftmost-trust Next port was a rate-limit-bypass vuln.
- **HSTS** on the Go API (Cloud Run doesn't add it): `Strict-Transport-Security: max-age=31536000; includeSubDomains` (add `preload` only after the apex leaves Vercel).
- **Every route is a Huma operation** (uniform OpenAPI, `Operation.Security`-driven middleware; OAuth 302s via `DefaultStatus:302` + output-header fields). Auth files group **by flow** (login/register/password/oauth/tokens), not file-per-op — coupled flows, unlike independent CRUD domains.
- Config via `caarlos0/env` (struct tags = existing `.env` names, no renames); only `DATABASE_URL` + `REDIS_URL` are required. `API_BASE_URL` builds the OAuth `redirect_uri` (distinct from the SPA URL the callback 302s to). `REDIS_URL` is provider-agnostic (`redis.ParseURL`).

### Backend domain pattern

The vertical-slice shape, validation/errors, IDOR scoping, data access, and testing are owned by `.agents/rules/go-coding-standards.md`. Feature-specific detail not in that rule:

- **Writes:** connect-or-create tags go through the implicit `_ItemTags` join (`A`/`B` columns).
- **Reads:** `COALESCE(LEFT(col,150),'')::text` previews mapped `""`→`null`; collections via `jsonb_agg`→`[]byte`.
- **Rate limiting:** only where parity exists. `ratelimit.BucketItemMutation` (120/1h, keyed by `userId`) on item mutations; **no** collection/search bucket.
- **Payload parity:** reproduce `""`→`null` coercion (`description`/`content`/`url`/`language`, collection `description`); `tags`/`collectionIds` default `[]`; URL must be `http(s)://` or empty.

### Frontend stack

- **TanStack Start in SPA mode** (`spa: { enabled: true }`) — static build, no server runtime, deploys to Firebase. Adopted at F0 (one stack F0→F3, no mid-project migration; F3 just enables `/` prerender). ⚠ Start is a **v1.0 RC, not GA** — **pin the exact `@tanstack/react-start` version**, watch the changelog. (Vike was the mature alternative, passed over for TanStack ecosystem cohesion + type-safe routing.)
- **Vite + TanStack Query + Zustand.** `autoCodeSplitting: true` (not `.lazy.tsx`), `defaultPreload: 'intent'`, dev `vite.config.ts` proxies `/api/*` → local Go (same-origin, no CORS in dev).
- **API client = `@hey-api/openapi-ts`** Fetch client + its TanStack Query plugin (options-based `queryOptions()` compose with `ensureQueryData`). ⚠ Pre-1.0, ESM-only, ~15 breaking changes per release, fetch client not default — **pin exact version**, treat regen as a reviewed event, generate against the real Huma 3.1 spec and eyeball unions/nullables. `baseUrl` = `/api` (dev proxy) / `https://api.devstash.one` (prod, `credentials: 'include'`).
- **Auth guard = router context + `beforeLoad`** (not a root-layout component guard — that's the Next-middleware anti-pattern). `createRootRouteWithContext<{ queryClient }>()` carries the QueryClient; a **pathless `_app` layout route** (`routes/_app/route.tsx`, underscore, **not** a `(app)` parens group — parens are organizational only) guards its subtree:
  ```ts
  beforeLoad: async ({ context, location }) => {
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions)
    if (!session) throw redirect({ to: '/sign-in', search: { redirect: safeRelative(location) } })
  }
  ```
  `__root` stays public (wraps marketing + auth pages). The guard is **UX-only** — every endpoint IDOR-scopes independently, so a bypass leaks nothing.
- **Session = TanStack Query single source of truth** (`sessionQueryOptions` → `GET /auth/session`), not Zustand (Zustand is UI-state only). `queryFn` returns `null` on 401 and **throws** on network/5xx (a blip must hit an `errorComponent`, never a false logout).
- **Auth-change (login/logout/password-change):** `forcePending` unmounts the protected subtree before the redirect resolves (a plain `router.invalidate()` leaves the component rendering + querying during logout). Two variants of the pre-invalidate step: **logout/session-death** `setQueryData(['auth','session'], null)` (known terminal state) then `invalidateQueries({queryKey:['auth'], refetchType:'none'})` then `router.invalidate({forcePending:true})`; **login/account-link** must `await queryClient.refetchQueries({ queryKey: ['auth'] })` **then** `router.invalidate({forcePending:true})` — the login 204 carries no session body, so the cache still holds the pre-login `null`; `invalidateQueries({refetchType:'none'})` would leave that stale null in place and the `_app` guard's `ensureQueryData` (which never refetches non-`undefined` cache) would bounce the just-logged-in user back to `/sign-in`. `refetchQueries` forces a real GET regardless of staleTime.
- **Runtime 401 is load-bearing** — `ensureQueryData` ignores `staleTime`/returns stale cache, so `beforeLoad` can't self-heal a mid-session expiry; only the client **response interceptor** catches it: `setQueryData(['auth','session'], null)` + the `forcePending` invalidate above. **401 only** (never 403 — authorized-but-forbidden must not log out). Reserve TanStack Query `QueryCache.onError` for thrown-error telemetry only (single owner, no double invalidate).
- **Open-redirect guard:** store a **relative path** (`pathname+search+hash`), never `location.href`. Validate **on consumption** via parse + same-origin (`new URL(raw, origin)`, confirm `url.origin === location.origin`; reject `//`, `/\`, backslash, `%2f%2f`/`%5c`, control chars). `validateSearch` the `redirect` param with zod `.catch('/dashboard')`.
- **Per-route `errorComponent` + `pendingComponent` + a `notFoundComponent`** (the Firebase rewrite routes unknown paths into the SPA). Route `loader` + `ensureQueryData` for blocking data (each with a matching component `useQuery`/`useSuspenseQuery` subscription, or the entry is GC'd), `useQuery` for deferred. No bare `useEffect(fetch)`.
- OAuth buttons are plain `window.location.assign('https://api.devstash.one/auth/oauth/{github,google}/start')` (a justified hard cross-origin redirect); Go's callback 302s back with the cookie set.
- **Component kit = shadcn/ui (Base UI flavor)** (adopted 2026-07-16, replacing the hand-rolled kit). Package `@base-ui/react` + `cva`; `components.json` `style: base-nova` pins the flavor so `shadcn add` stays on Base UI. **Radix is banned in `web/`** — React 19 + the React Compiler hit ref-callback bugs in Radix collection primitives; Base UI is the React-19-safe layer. The `shadcn init --base base` wizard is TTY-only and its Nova reinstall clobbers `utils.ts`/`app.css`/`field.tsx` — back up first (details in the rule `tailwind.md`). `button`/`input`/`field`(+`label`) are canonical shadcn Base UI; `field` keeps the canonical `Field`/`FieldLabel`/`FieldError` API but trims shadcn's unused compound helpers (they trip the repo's strict oxlint). Only `favorite-star` (a domain glyph, no shadcn equivalent) stays hand-owned. Canonical loading = `disabled` + a spinner child (no custom `loading` prop); link-as-button = `buttonVariants({ variant })`.

### Frontend security

**CSP — header delivery, built post-build.** The original F0 plan (`vite-plugin-csp-guard` emitting `script-src 'sha256-…' 'strict-dynamic'`) was **abandoned: the plugin is incompatible with Start's build.** What actually ships:

- `scripts/finalize-dist.ts` (wired into `npm run build` after `vite build`) sha256-hashes every executable inline script across all emitted HTML and writes the **union** as an HTTP **`Content-Security-Policy` response header** into a generated `firebase.json`, from the committed `firebase.template.json`. It fails closed (`process.exit(1)`) on zero HTML or zero hashes. `firebase.json` is **gitignored/generated** (hashes change per build) — edit the template, never the output.
- `script-src 'self' <hashes>` — **not** `strict-dynamic`. `style-src` still needs `'unsafe-inline'` (Tailwind/React). Enforced immediately, not Report-Only.
- Header (not `<meta>`) delivery — OWASP-preferred — allows in-policy `frame-ancestors 'none'` (X-Frame-Options kept as a legacy fallback) + `report-to csp-endpoint` + `Reporting-Endpoints` pointing at the Go API `POST /csp-report` (public Huma op in `internal/cspreport`, best-effort slog telemetry, on the security-guard allowlist, IP-keyed rate limit `BucketCSPReport` 30/1m fail-closed as a log-flood guard on the unauthenticated op).
- Also `default-src 'self'; connect-src 'self' https://api.devstash.one; object-src 'none'; base-uri 'none'; form-action 'self'`. A build-time nonce is worthless on a static CDN — hashes are the mechanism.
- `scripts/gen-og-image.tsx` runs first in the build (Satori→PNG OG card) before `vite build` copies `public/`.

**Other headers:** `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin` (safe — OAuth is a full-page redirect, not a popup), `Permissions-Policy` as an explicit deny-list (`camera=(), microphone=(), geolocation=(), payment=(), usb=()`, …). Vite `build.modulePreload.polyfill: false`. **Do NOT** add COEP/CORP — it would break cross-origin images.

**Trusted Types** (`require-trusted-types-for 'script'`) is **deferred**, not in the shipped policy. Header delivery + the `report-to`/`csp-report` endpoint were its prerequisite and are now in place; next step is TT report-only (needs a `Content-Security-Policy-Report-Only` header), then enforce after confirming no library DOM-sink breakage. The `deferred-spa-loader` uses `document.createElement('script')` + `.src=` — a URL assignment, CSP-governed, **not** a TT-governed injection sink — so it won't block TT.

**Dev/prod render split:** dev runs Start's SSR dev server, prod builds SPA mode — so CSP injection and `/` prerender are exercised **only in a prod build** (documented in `vite.config.ts`). A `build && preview` CI smoke step would close the "green in dev, broken in prod" gap.

### Hosting & CI

- **Firebase Hosting (classic)**, on the existing `devstash` GCP project — same billing/IAM as Cloud Run, free Spark tier, global CDN. Escape hatch if Spark transfer is exceeded: repoint DNS to Cloudflare Pages (the migration is just DNS).
- **Standalone `beta.devstash.one`; Vercel is never in the SPA's request path** (no rewrites/proxy). The SPA calls Cloud Run directly (cross-origin) and only ever talks to Go — so an F2 page ships **only after its data domain is on Go**. Hosting serves `dist/client` and rewrites `** → /_shell.html`.
- **CORS:** backend sends `Access-Control-Allow-Credentials: true` + `ALLOWED_ORIGINS` (`https://beta.devstash.one` in transition → `https://devstash.one` after cutover). Documented fallback that voids CORS: a Firebase `rewrite` of `/api/**` → the Cloud Run service (same-origin) — not adopted.
- **CI:** a `web/**`-scoped Cloud Build trigger (`envs/prod` `module "web_cloudbuild_trigger"`, not a GitHub Action): `npm ci` → `npm run build` (Node 24 via `mirror.gcr.io/library/node:24`) → deploy via Google's official `us-docker.pkg.dev/firebase-cli/us/firebase` image, auth = trigger SA **ADC via the CB metadata server**. Runs as least-priv **`devstash-web-deployer`** (`firebasehosting.admin` + `serviceusage.apiKeysViewer`), built from the shared `modules/cloudbuild-deployer-sa` submodule (the backend `devstash-backend-deployer` is the sibling). Backend build is a single **`ko build`** step (`backend/.ko.yaml`, distroless, no Dockerfile/daemon); the Dockerfile is kept as a deprecated fallback. ⚠ ko pipeline unverified against a real Cloud Build run.

### Testing

Go testing conventions are owned by `.agents/rules/go-coding-standards.md § Testing`. Coverage is gated by `backend/.testcoverage.yml` — read the config, which is authoritative. Note the `internal/auth` override is an anchored **package aggregate** (`^internal/auth$` ≥ 85), *not* a per-file bar.

`web/` ships **zero tests** by decision — see `.agents/rules/web-architecture.md`.

## Shipped

### Backend

- **Phase 0** — Huma v2 on `net/http` (`humago` + hand-rolled RequestID/Recover middleware), `GET /health` + SwaggerUI. Cloud Run auto-deploy (scale-to-zero, `api.devstash.one`), distroless static image, defaults to `serve` on bare launch. goose baseline marked already-applied on Neon `dev`.
- **Phase 1** — `POST /auth/login` (+cookie), `GET /auth/session`, `POST /auth/logout`; all 6 credential flows (register/verify-email/resend/forgot/reset/confirm-login-email, enumeration-safe, Redis one-time tokens via GETDEL + compare-and-delete Lua, Resend email behind an `Emailer` interface); OAuth github/google (start/callback all-302, pending-link account conflict, `POST /auth/link`). Files by flow in `internal/auth`. Gates: lint 0, race pass, `internal/auth` package aggregate ≥85%, total 92.2%.
- **Phase 2** — `internal/{items(9),collections(5),search(1)}` + sqlc in `db/queries/{items,collections,search}.sql`. Reproduces: three 403 branches on `POST /items` (Pro-only type, `FREE_TIER_ITEM_LIMIT=50`, invalid file reference — S3 deferred to Phase 3, so `file`/`image` create is a 403 for now), `FREE_TIER_COLLECTION_LIMIT=3`; `isPro` read-only from `isPro && stripeSubscriptionId != nil` (no Stripe call); two-sided retype guard + language remap; cursor pagination (`{isPinned,createdAt,id}` desc, favorites `{updatedAt,id}`, `ITEMS_PAGE_SIZE=20`); discriminated-union `GET /items` query; `ILIKE`-substring search (items ≤20, collections ≤10) with `\ % _` escaping; collection PATCH description-presence via `description_set`. Uniform-superset `LightItem` (additive) is the one shape change; strict payload parity otherwise (drift-guards stay green — API-shape redesign deferred to the Frontend Track). Constants mirrored as Go consts (`TEXT_ITEM_TYPE_NAMES={snippet,prompt,command,note}`, `ITEM_TYPES_WITH_URL={link}`, `ITEM_TYPES_WITH_FILE={image,file}`, `PRO_ITEM_TYPE_NAMES={file,image}`, `ITEM_DESCRIPTION_MAX_CHARS=2000`, …).
- **Huma spec fix** — Huma omitted the `{id}` path param from the OpenAPI spec for the 5 PATCH ops that embed `idPath` alongside a `Body` (spec-only; runtime was fine) → broke the generated client. Inlined `ID string path:"id"` in `internal/items/{favorite,pinned,update}.go` + `internal/collections/{favorite,update}.go`.

### Frontend

Gates green: `tsc --noEmit` 0, `oxlint .` 0, `vite build` OK; runtime-verified in a browser (marketing renders + hydrates under CSP with no violations; client routing works).

- **F0** — `__root` (public) + `router.tsx` (`getRouter`, QueryClient in context + `Wrap` provider) + `_app/route.tsx` (pathless guard; needs ≥1 child or it collides with `index` at `/`). `sessionQueryOptions` (401→null, 5xx→throw) + `resolveOptionalSession` (public auth pages must render even if the session check fails) + `sanitizeRelative` open-redirect guard + auth-change invalidation + 401 response interceptor. CSP as described above.
- **F1** — all 6 auth pages, driving the Phase-1 endpoints. `link-account` consumes the pending-link `token` + password re-check → `POST /auth/link`.
- **F2 (Phase-2 slice)** — dashboard, `/items/[type]`, `/collections` + `/collections/[id]`, `/favorites`. `/profile` and `/settings` remain blocked on Phases 4/5.
- **F3** — marketing homepage with per-route static prerender of `/`.
  - **Prerender gotcha:** SPA mode pushes a shell page at `spa.maskPath` (default `/`), which collides with the `/` content page in the path-keyed prerender dedup → only `_shell.html` emits, no real homepage. Fix: `maskPath: '/shell'` (a tiny real `routes/shell.tsx` mask route) + `pages:[{path:'/', prerender:{outputPath:'/index.html', crawlLinks:false}}]` → both `index.html` (marketing) and `_shell.html` emit.

**Stack (latest, per user):** Vite 8 + `@vitejs/plugin-react` 6 (**React Compiler ON** via `@rolldown/plugin-babel` + `reactCompilerPreset` — `useMemoCache` confirmed in bundle), TanStack Start 1.168 (SPA mode) + Router 1.170 + Query 5.101, Zustand 5 (UI state only), Tailwind v4, Hey API `@hey-api/openapi-ts` 0.99 client + TanStack Query plugin. TypeScript pinned `^5.9.3` and `exactOptionalPropertyTypes` OFF — both for generated-client compat (the other 5 new strict flags pass).

### Design mirror (2026-07-14 — reverses the "fresh redesign")

The fresh emerald/mono "dark developer" redesign was dropped for a port of the live `devstash.one` "modern-minimal" dark theme (old shadcn/base-nova look).

- **Tokens** in `web/src/styles/app.css` swapped to modern-minimal dark values (`--background:oklch(0.2 0 0)`, `--card:oklch(0.27 0 0)`, blue `--primary:oklch(0.62 0.19 259.81)`, `--muted-foreground:oklch(0.72 0 0)`, `--border/--input:oklch(0.37 0 0)`, `--radius:0.375rem`) + **Geist** (`@fontsource-variable/geist`, self-hosted, CSP `font-src 'self'`).
- **Auth pages** mirror the old markup: `AuthShell` = fixed dot-grid + blue/cyan glow-blob backdrop, centered `Archive` + blue→cyan-gradient "DevStash" lockup, centered card header (`border-white/10 bg-card/50 backdrop-blur-sm shadow-xl`); `Input` → translucent `bg-input/30`; `Field` label → `text-sm font-medium text-foreground`; sign-in/register reordered form-first → divider → OAuth. `AuthShell` also takes optional `icon`/`iconVariant` (`success`=emerald / `error`=destructive / `info`=primary) / `iconSpin` → a `size-14` tinted circle with a `size-7` glyph above the title (register check-email, verify success/error/verifying, reset invalid/done), mirroring the live `CircleX`/`CircleCheck` status pages.
- **Marketing homepage** (`web/src/routes/index.tsx` + `components/marketing/*`) — ported exact copy/markup from the old `src/app/(marketing)/page.tsx`: hero ("Stop Losing Your / Developer Knowledge", blue→indigo gradient, "Developer Knowledge Hub" pulse badge, "Start for Free"/"See Features", trusted-by), features ("Everything you need to stay in flow" + 6 glyph-icon cards `</>`/`✦`/`⌕`/`$_`/`📁`/`⊞` with hex accents + gradient-border cards), AI section ("AI that actually understands code" + `✦ Pro Feature` cyan badge + `✓` checklist + TS `useAuth` code block + AI-generated tags), CTA + 3-column footer.
- **Item-type palette** (`web/src/lib/item-types.ts`) changed **app-wide** to the live values (snippet=blue/Code, prompt=violet/MessageSquare, command=orange/Terminal, note=yellow/StickyNote, link=green/Link, file=gray, image=pink) — affects dashboard/cards/sidebar too (user approved app-wide).
- Chaos-canvas floating icons intentionally kept as the new set (user choice). `web/` keeps its own small UI kit in `web/src/components/ui` — no shadcn.
- **Dark-only, by design:** `app.css` ships a single (dark) token set with no light-theme override, deliberately mirroring the live `devstash.one` site's dark-only look. This is a standing exception to `tailwind.md`'s "dark is baseline, light is a secondary target" guidance — not a gap to fill.

### Cleanups

- **Web linting hardening** — `web/.oxlintrc.json` tightened with the measured zero-cost style/import/promise/TypeScript/Unicorn rule batch, plus `prefer-template`, `unicorn/prefer-string-replace-all`, `no-negated-condition`, `promise/prefer-await-to-then`, and top-level type-import style. `no-void` remains intentionally rejected — it conflicts with sanctioned fire-and-forget `void queryClient.invalidateQueries(...)`. `scripts/**` (incl. the CSP build script) is excluded from oxlint via `ignorePatterns`; its enforcement is type-checking through `tsconfig.scripts.json`, wired into `npm run build`, not lint.
- **Web audit** — fixed 7 code-quality findings (imports consolidation, type safety, interceptor race-condition protection, redirect security comments).
- **Marketing cleanup (2026-07-15)** — extracted `chaos-simulation.ts` from `chaos-canvas.tsx` (321→37 lines): the rAF/physics/pointer world is now a plain `createChaosSimulation(canvas) → { setInView, destroy }` factory owning its own state, so nothing is threaded through params and the `CanvasControls` ref workaround is gone. Corrected the `FadeIn` `armed` comment, which claimed to prevent a fade-out that cannot happen (`opacity-0` applies only while `!visible`, and the rect check claims every viewport-overlapping element in the same render) — it buys only the narrow flick-down-within-700ms reversal. Scroll-driven CSS (`animation-timeline: view()`) evaluated and **rejected**: not Baseline (Firefox still flag-gated), and `animation-delay` is inert on scroll timelines, which would silently kill the grid stagger since same-row cards share a scroll position. `max-lines` now counts code, not prose (`skipComments`/`skipBlankLines`, max stays 300).

## Later backend phases (not yet planned in detail)

- **Phase 3** — file/image upload/download (S3 presign + Redis pending-upload consume; unblocks the `file`/`image` 403 and DELETE blob cleanup).
- **Phase 4** — profile (unblocks F2 `/profile`; incl. the deferred signed-in "Add account" link-intent flow).
- **Phase 5** — Stripe/billing writes + subscription management (unblocks F2 `/settings`).
- **Phase 6** — AI Brain-dump (`ai_parse_job_items`) + realtime (credentialed `EventSource` across subdomains).

## Remaining / cutover

External steps, not backend code.

- **Phase 1 cutover:** add Go's callback URIs to the GitHub/Google OAuth app allowlists + set `AUTH_GITHUB_*`/`AUTH_GOOGLE_*`/`API_BASE_URL` in prod `APP_CONFIG`; apply the `__Host-` cookie rename + API HSTS header; delete `src/app/api/auth/**` + `src/auth.ts`/`src/lib/auth/**`/`src/lib/session.ts` + `src/actions/auth/*`; Vercel edge rewrite for the auth prefix → `api.devstash.one`.
- **Phase 2 cutover:** delete `src/app/api/{items,collections,search}/**` + their Vitest tests; Vercel edge rewrite `/api/{items,collections,search}/*` → `api.devstash.one`.
- **F0 external:** add Firebase DNS records for `beta.devstash.one` (Spaceship CNAME/A); add `https://beta.devstash.one` to `ALLOWED_ORIGINS`; delete `src/proxy.ts` (the Next 16 middleware→proxy rename of the old `src/middleware.ts`; it holds `export const proxy = auth`).
- **Final cutover (post-F3 + Phase 6):** repoint apex `devstash.one` DNS Vercel→Firebase (two A records + TXT), delete the Vercel project, retire `beta.`.

## Out of scope

- Encore.dev, an identity server (Zitadel/Kratos), and the legacy NextAuth JWE decode (forced re-login instead).
- Any Node dependency inside `backend/`; `tailwind.config.ts` (Tailwind v4 CSS config carries to `web/`).
- Schema changes to Neon during the transition; moving `infra/` GKE to production (stays a $0-idle learning sandbox).
- `backend/exercise/` — an independent Go learning course, not DevStash; never reviewed/edited.
