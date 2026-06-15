# ApiBod — Standalone API Communication Protocol Library

> **Package name (working):** `apibod`  
> **Repository:** New standalone repo / branch — **not** part of any consumer application  
> **Status:** Specification — not yet implemented  
> **Kind:** Protocol + TypeScript types — **not** a framework  
> **Target runtimes:** Any **Node.js** project (primary); also browsers, Bun, Deno, Edge — **including Next.js**, not limited to it

---

## 1. Project Scope

### 1.1 What is being built

A **new, independent npm package** that publishes a strict, **runtime- and framework-neutral** contract for JSON communication between a client and a server.

The library is designed for **any Node.js HTTP API** — Express, Fastify, Hono, NestJS, raw `node:http`, serverless handlers, CLI tools that expose JSON, etc. **Next.js** (App Router routes, server actions) is a **supported consumer**, not a requirement.

The library answers one question:

> **What shape may application JSON have when crossing the client–server boundary?**

It ships **types, constants, type guards, and a normative protocol document** — nothing more. No imports from `next`, `react`, or any HTTP framework.

### 1.2 What is not being built (in this repo)

| Out of scope for `apibod` | Typical consumer responsibility |
|---------------------------|--------------------------------|
| HTTP route wrappers | App or `@apibod/next` sibling package (future) |
| Fetch / axios clients | App or `@apibod/client` sibling package (future) |
| Response builder helpers | ~30 lines in consumer, using `apibod` types |
| Validation (Zod, etc.) | Consumer choice |
| Auth, rate limiting, logging | Consumer middleware |
| React hooks | Consumer or `@apibod/react` sibling package (future) |
| Framework adapters (Express, Fastify, Next.js, …) | Consumer or optional `@apibod/*` adapter packages |

### 1.3 Runtime compatibility (normative for the package)

The **core `apibod` package** MUST work in all of the following without polyfills:

| Runtime | Support |
|---------|---------|
| Node.js | **Primary** — ≥ 18 LTS (uses standard `JSON`, no Node-only APIs in core) |
| Browser | Yes — types + guards only; suitable for SPAs, React, Vue, etc. |
| Bun / Deno | Yes — standard ESM/CJS build |
| Edge (Vercel Edge) | Yes — no Node built-ins in core |
| Next.js (Node / Edge runtimes) | Yes — as a consumer; **not** a peer dependency |

The protocol is **plain JSON over HTTP** (or any transport that carries JSON). It does not depend on Server Actions, the App Router, or React Server Components.

### 1.4 Relationship to consumer applications

Any project that exchanges JSON between client and server may add `apibod` as a dependency:

- Node.js REST APIs (Express, Fastify, Hono, NestJS, …)
- Next.js full-stack apps (routes + server actions)
- Electron / Tauri apps calling a local or remote API
- Mobile or desktop clients consuming the same envelope (via JSON Schema)

Typical benefits:

- Replace locally duplicated type definitions
- Share one canonical protocol across backend, web, and other clients
- Validate untrusted responses with `isApiBody()`
- Document API behavior via shipped `PROTOCOL.md`

**Adoption is optional and incremental.** The core package does not assume Next.js, React, or any specific HTTP framework.

### 1.5 Dependency policy

```
apibod
├── dependencies:     (none)
├── peerDependencies: (none)
├── devDependencies:  typescript only (for build)
└── transitive deps:  zero at runtime
```

Installing `apibod` must not pull any other package into the consumer's dependency tree.

---

## 2. Design Principles

1. **Spec over implementation** — the package is the contract; runtimes live elsewhere.
2. **Zero transitive dependencies** — safe in browser, Node, Edge, and shared `types` packages.
3. **Node.js first, framework-agnostic** — any HTTP stack on Node (or elsewhere) can emit and parse `ApiBody`; Next.js is one consumer among many.
4. **One envelope** — all application JSON responses use the same top-level shape.
5. **Semantic status in body** — `status` is the primary discriminator; HTTP status is derived when transported over HTTP.
6. **Fail closed on parse** — malformed payloads are treated as errors at the client boundary.
7. **Versionable** — optional `v` field for future envelope revisions.

---

## 3. Wire Format (Normative)

### 3.1 Envelope

Every conformant application-level JSON response **MUST** be an object:

```ts
type ApiBody<T = null> = {
  /** Protocol version. Omitted means v1. */
  v?: 1
  /** Semantic outcome. Required. */
  status: ApiStatus
  /** Success payload, or null on error / empty success. */
  data: T | null
  /** Human-readable message, or null when not applicable. */
  message: string | null
}
```

### 3.2 Status vocabulary (closed set, v1)

```ts
type ApiStatus =
  | 'ok'
  | 'created'
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'validation_error'
  | 'too_many_requests'
  | 'internal_error'
```

Rules:

- **MUST** use only these literals in protocol v1.
- **MUST NOT** add per-endpoint status strings.
- **MUST NOT** encode HTTP codes in `status`.
- **MUST NOT** use `success: boolean` as the primary discriminator.

### 3.3 HTTP status mapping

When transported over HTTP, conformant servers **MUST** set the HTTP status from this table:

| `ApiStatus` | HTTP | `data` | `message` |
|-------------|------|--------|-----------|
| `ok` | 200 | payload or `null` | usually `null` |
| `created` | 201 | payload or `null` | optional |
| `bad_request` | 400 | `null` | **required** |
| `unauthorized` | 401 | `null` | recommended |
| `forbidden` | 403 | `null` | recommended |
| `not_found` | 404 | `null` | recommended |
| `conflict` | 409 | `null` | recommended |
| `validation_error` | 422 | structured (§3.4) | recommended |
| `too_many_requests` | 429 | optional (§3.5) | **required** |
| `internal_error` | 500 | `null` | optional (safe generic text) |

The response body **MUST** always be a full `ApiBody`. Clients **MUST** use `body.status` for application logic, not HTTP status alone.

### 3.4 Validation error payload

When `status === 'validation_error'`, `data` **SHOULD** be:

```ts
type ValidationErrorData = {
  issues: Array<{
    path: (string | number)[]
    message: string
    code?: string
  }>
  fieldErrors?: Record<string, string[]>
}
```

`issues` is canonical; `fieldErrors` is optional sugar for form UIs.

### 3.5 Rate limit payload

When `status === 'too_many_requests'`, `data` **MAY** be:

```ts
type RateLimitData = {
  retryAfter?: number  // seconds
}
```

Servers **SHOULD** send HTTP `Retry-After` when `retryAfter` is known.

### 3.6 Success vs error

```ts
type ApiSuccessStatus = 'ok' | 'created'
type ApiErrorStatus = Exclude<ApiStatus, ApiSuccessStatus>
```

### 3.7 Documented exemptions

These **MAY** bypass `ApiBody`; each must be listed in consumer API docs:

| Case | Rule |
|------|------|
| Third-party webhooks | Provider's native format |
| Binary / streaming | Non-JSON `Content-Type` |
| Auth redirects | HTTP 3xx, no JSON body |
| Infrastructure health | Minimal non-envelope JSON allowed |

All other **application JSON** endpoints and **handlers that return data to a client** **MUST** use `ApiBody`.

### 3.8 Design evaluation — full HTTP status coverage vs `ApiStatus`

This section records the decision on whether `ApiStatus` should include **all** HTTP status codes and whether the core package should import Node.js `http.STATUS_CODES`.

#### 3.8.1 What Node.js provides

Node.js `node:http` exposes `STATUS_CODES`: **63** numeric codes → English reason phrases (e.g. `404` → `'Not Found'`). It does **not** provide:

- Stable snake_case identifiers (`not_found`)
- A 1:1 semantic model for application errors
- Browser or Edge compatibility (module is Node-only)

`http.constants` / `http2.constants` expose named constants (`HTTP_STATUS_NOT_FOUND`, etc.) — useful for **servers**, not for a portable JSON envelope type.

#### 3.8.2 Option A — Mirror all HTTP codes in `ApiStatus` ❌ Not recommended

Example shapes considered:

| Approach | Example | Problem |
|----------|---------|---------|
| Numeric string in `status` | `'404'`, `'503'` | Violates §3.2; couples body to transport |
| Reason-phrase snake_case | `'not_found'`, `'i_m_a_teapot'` | 63 literals; many never used in app APIs |
| Prefix namespace | `'http_404'`, `'http_503'` | Redundant with HTTP header; awkward in client `switch` |
| Generated union from `STATUS_CODES` | 63-member union at build time | Core depends on Node at build time; churn on Node updates |

**Why reject:**

1. **Duplication** — HTTP status is already on the response line; putting the same information in `body.status` as a code adds little for clients that already have `isApiBody` + `body.status` semantics.
2. **Wrong abstraction** — App logic cares about *meaning* (`validation_error` vs `bad_request`), not RFC 7231 inventory. `422` and `400` both mean “client fixable” but need different `data` shapes.
3. **Noise** — `102 Processing`, `418 I'm a Teapot`, `508 Loop Detected` are not application-level outcomes for typical JSON APIs.
4. **Breaks browser-first core** — Importing `node:http` in `apibod` core conflicts with §1.3 (zero Node APIs, universal guards).
5. **OpenAPI / mobile** — Non-Node clients cannot depend on Node’s table; they need a fixed, documented semantic set.

#### 3.8.3 Option B — Curated semantic `ApiStatus` (current v1) ✅ Recommended

Keep a **closed, semantic** vocabulary (§3.2). Map each literal to **one** HTTP code for transport (§3.3). Application code branches on `body.status`, not on raw HTTP.

**v1 set (10 literals)** covers the majority of JSON APIs:

| Need | `ApiStatus` | HTTP |
|------|-------------|------|
| Success | `ok` | 200 |
| Created | `created` | 201 |
| Generic client error | `bad_request` | 400 |
| AuthN | `unauthorized` | 401 |
| AuthZ | `forbidden` | 403 |
| Missing resource | `not_found` | 404 |
| State conflict | `conflict` | 409 |
| Schema / input validation | `validation_error` | 422 |
| Rate limit | `too_many_requests` | 429 |
| Server fault | `internal_error` | 500 |

**Unmapped HTTP codes** (when the server must use them on the wire):

| HTTP | Recommended handling |
|------|----------------------|
| `204` No Content | Exemption or `ok` + `data: null` (prefer `200` + envelope for conformant JSON APIs) |
| `301`–`308` Redirect | §3.7 exemption — not `ApiBody` |
| `410` Gone | `not_found` or `conflict` + message until v1.1 adds `gone` |
| `413` Payload Too Large | `bad_request` + message, or v1.1 `payload_too_large` |
| `502` / `503` / `504` | `internal_error` on the client; infra may use raw HTTP at proxy |
| `501` Not Implemented | `internal_error` or v1.1 `not_implemented` |

#### 3.8.4 Option C — v1.1 extension (optional minor additions) 🟡 Consider later

If real consumers need them, add **semantic** literals (not all 63 HTTP codes):

```ts
// Illustrative v1.1 candidates — each maps to exactly one HTTP code
| 'accepted'              // 202
| 'no_content'            // 204 — rare with envelope; prefer ok + null data
| 'gone'                  // 410
| 'payload_too_large'     // 413
| 'unsupported_media_type'// 415
| 'not_implemented'       // 501
| 'bad_gateway'           // 502
| 'service_unavailable'   // 503
| 'gateway_timeout'       // 504
```

Still a **small curated set** (~20 literals), not auto-generated from Node.

#### 3.8.5 Node.js import strategy ✅ Recommended split

| Package | Node `http` usage |
|---------|-------------------|
| **`apibod` (core)** | **None.** Static `HTTP_STATUS_BY_API_STATUS` const object (~10–20 entries). Works in browser, Deno, Bun, Edge. |
| **`@apibod/node` (optional sibling)** | **May** use `import { STATUS_CODES } from 'node:http'` for helpers only: `getReasonPhrase(404)`, `isValidStatusCode(n)`, logging, tests. Peer: `node` ≥ 18. |
| **Consumer apps** | Use framework status (`res.status(404)`) + `apibod` for JSON body; no requirement to read `STATUS_CODES`. |

**Do not** use conditional `require('node:http')` inside core “if present” — it complicates bundlers (Next.js, Vite, esbuild), prevents static analysis, and still ships Node resolution logic to browsers. Keep Node helpers in `@apibod/node`.

Example optional helper (not in core):

```ts
// @apibod/node — optional package
import { STATUS_CODES } from 'node:http'
import { HTTP_STATUS_BY_API_STATUS, type ApiStatus } from 'apibod'

export function httpStatusForApiStatus(status: ApiStatus): number {
  return HTTP_STATUS_BY_API_STATUS[status]
}

export function reasonPhraseForHttp(code: number): string | undefined {
  return STATUS_CODES[code]
}
```

#### 3.8.6 Decision summary

| Question | Decision |
|----------|----------|
| Include all HTTP statuses in `ApiStatus`? | **No** — semantic curated set only |
| Import `node:http` in core if present? | **No** — static map in core; Node only in `@apibod/node` |
| Can HTTP code differ from table for proxies? | Yes at infra layer; **application JSON** still uses `ApiBody` + §3.3 mapping |
| How to add more statuses? | Minor semver + new semantic literal + one HTTP mapping row |
| Inverse map `API_STATUS_BY_HTTP`? | Best-effort partial map in core; many HTTP codes → `undefined` (intentional) |

---

## 4. Communication Surfaces (Normative)

The envelope is identical across surfaces. Transport mechanics are not defined by this package — only the JSON shape.

### 4.1 HTTP APIs (any Node.js or HTTP server)

Applies to **all** JSON HTTP handlers: Express, Fastify, Hono, NestJS, `node:http`, AWS Lambda, Next.js Route Handlers, etc.

**Server obligations**

- `Content-Type: application/json`
- Body is valid `ApiBody<T>`
- HTTP status from §3.3

**Express** (illustrative — not shipped by `apibod`):

```ts
import type { Request, Response } from 'express'
import type { ApiBody } from 'apibod'
import { HTTP_STATUS_BY_API_STATUS } from 'apibod'

function sendApiBody(res: Response, body: ApiBody<unknown>) {
  res.status(HTTP_STATUS_BY_API_STATUS[body.status]).json(body)
}

app.get('/users/:id', async (req: Request, res: Response) => {
  try {
    const user = await findUser(req.params.id)
    if (!user) return sendApiBody(res, { status: 'not_found', data: null, message: 'User not found.' })
    return sendApiBody(res, { status: 'ok', data: user, message: null })
  } catch {
    return sendApiBody(res, { status: 'internal_error', data: null, message: null })
  }
})
```

**Fastify** (illustrative):

```ts
fastify.get('/users/:id', async (request, reply) => {
  const body: ApiBody<User> = { status: 'ok', data: user, message: null }
  return reply.status(HTTP_STATUS_BY_API_STATUS[body.status]).send(body)
})
```

**Generic wrapper** (framework-agnostic):

```ts
function wrapHandler(handler: () => Promise<ApiBody<unknown>>) {
  return async () => {
    try {
      const body = await handler()
      return { status: HTTP_STATUS_BY_API_STATUS[body.status], json: body }
    } catch {
      return { status: 500, json: { status: 'internal_error', data: null, message: null } }
    }
  }
}
```

### 4.2 In-process / RPC handlers (optional frameworks)

Applies when the server invokes a function directly instead of HTTP — e.g. Next.js **server actions**, tRPC procedures exposed to a React client, Electron IPC, etc.

**Server obligations**

- Return `ApiBody<T>` (sync or `Promise`)
- Map unhandled failures to `internal_error` at the framework boundary

**Client obligations**

- Inspect `result.status` before `result.data`
- Surface `result.message` on error statuses

This surface is **optional**. A pure Node.js REST API uses §4.1 only.

**Next.js server actions** (one supported RPC style):

```ts
'use server'
export async function updateUser(...): Promise<ApiBody<{ id: string }>> {
  return { status: 'ok', data: { id: '1' }, message: null }
}
```

**React `useActionState`** (optional UI pattern):

```ts
type ActionState<T> = ApiBody<T> | null
```

### 4.3 Client HTTP consumers

**Client**

1. Parse JSON
2. Run `isApiBody(parsed)`
3. If invalid or network fails, synthesize a safe error:

```ts
const FALLBACK: ApiBody<null> = {
  status: 'internal_error',
  data: null,
  message: 'Network error. Please try again.',
}
```

**Illustrative consumer pattern** (not shipped by `apibod`):

```ts
async function fetchApi<T>(url: string, init?: RequestInit): Promise<ApiBody<T>> {
  try {
    const res = await fetch(url, init)
    const json: unknown = await res.json()
    return isApiBody(json) ? (json as ApiBody<T>) : FALLBACK
  } catch {
    return FALLBACK
  }
}
```

Works in **any** JS client: browser `fetch`, Node `fetch`, axios, `got`, mobile WebViews, etc.

### 4.4 Request bodies (inbound)

Protocol v1 **does not** define a request envelope. Requests are endpoint-specific JSON, `multipart/form-data`, or query params — regardless of framework.

Optional future extension (not v1):

```ts
type ApiRequest<T> = { data: T }
```

---

## 5. Published Package API

Single entry point. No framework subpaths in v1.

```ts
// Types
export type { ApiStatus, ApiSuccessStatus, ApiErrorStatus }
export type { ApiBody, ValidationErrorData, RateLimitData }
export type { ApiEndpoint }  // structural contract helper (§7)

// Constants
export const API_STATUSES: readonly ApiStatus[]
export const API_SUCCESS_STATUSES: readonly ApiSuccessStatus[]
export const API_ERROR_STATUSES: readonly ApiErrorStatus[]
export const HTTP_STATUS_BY_API_STATUS: Record<ApiStatus, number>
export const API_STATUS_BY_HTTP: Partial<Record<number, ApiStatus>>

// Pure guards / helpers
export function isApiBody(value: unknown): value is ApiBody<unknown>
export function isApiSuccess(status: ApiStatus): status is ApiSuccessStatus
export function isApiError(status: ApiStatus): status is ApiErrorStatus
export function assertApiBody(value: unknown): asserts value is ApiBody<unknown>
export function getApiData<T>(body: ApiBody<T>): T | null
```

**Explicitly not in `apibod`:** `ApiResponse`, `apiRoute`, `apiFetch`, validators, framework adapters.

Consumers may implement thin builders locally:

```ts
import type { ApiBody, ApiStatus } from 'apibod'

function make(status: ApiStatus) {
  return <T>(data: T | null = null, message: string | null = null): ApiBody<T> =>
    ({ status, data, message })
}

export const ok = make('ok')
export const notFound = (message: string) => make('not_found')(null, message)
```

---

## 6. JSON Schema

Ship `schema/apibod.schema.json` for OpenAPI components, contract tests, and non-TypeScript clients.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "ApiBody",
  "type": "object",
  "required": ["status", "data", "message"],
  "properties": {
    "v": { "const": 1 },
    "status": {
      "enum": [
        "ok", "created", "bad_request", "unauthorized", "forbidden",
        "not_found", "conflict", "validation_error", "too_many_requests", "internal_error"
      ]
    },
    "data": true,
    "message": { "type": ["string", "null"] }
  }
}
```

Per-endpoint `data` schemas are consumer-defined.

---

## 7. Contract Typing (types only)

Structural types for documenting operations without a runtime router:

```ts
type ApiEndpoint<TData, TErrorData = null> = {
  readonly successStatus: ApiSuccessStatus
  readonly data: TData
  readonly errors?: Partial<Record<ApiErrorStatus, TErrorData>>
}

// Consumer-defined map — example only
type ExampleContract = {
  'users.get': ApiEndpoint<{ id: string; name: string }>
  'users.create': ApiEndpoint<{ id: string }, ValidationErrorData>
}
```

Future optional packages (`@apibod/contract-tools`, etc.) may generate OpenAPI or clients from these maps. They are **separate repos** with their own dependencies.

---

## 8. Repository Structure

Standalone git repository (or dedicated branch until split):

```
apibod/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts
│   ├── types.ts
│   ├── constants.ts
│   └── guards.ts
├── schema/
│   └── apibod.schema.json
├── PROTOCOL.md              # normative spec (§3–§4)
├── README.md                # install, quickstart, conformance
├── CHANGELOG.md
└── LICENSE
```

**Build:** ESM + CJS + `.d.ts`  
**Runtime size target:** < 2 KB gzip (guards + constants only)  
**License:** MIT (recommended for protocol packages)

### 8.1 Branching / release model

| Branch | Purpose |
|--------|---------|
| `main` | Stable protocol v1 |
| `feature/*` | Spec or API additions |
| Tags | Semver (`1.0.0`, `1.1.0`, …) |

Consumer apps pin `apibod` in their own repos independently.

---

## 9. What Consumers Implement

The library defines **what** crosses the wire. Each consumer app supplies **how**:

| Layer | Consumer implements | Uses `apibod` for |
|-------|---------------------|-------------------|
| Types in handlers | App code | `ApiBody<T>`, `ApiStatus` |
| HTTP middleware / route wrapper | App code (Express, Fastify, Next.js, …) | `HTTP_STATUS_BY_API_STATUS`, `isApiBody` |
| HTTP client | App code | `isApiBody`, `ApiBody<T>` |
| Response builders | App code (optional) | Types only |
| Lint / CI rules | App or `@apibod/eslint` | Import from `apibod`, ban alternate shapes |
| Validation of `data` | Zod / Valibot / etc. | Separate from envelope guard |

**Composition rule:** any Node.js HTTP stack (or RPC layer) may be used internally; **the last mile over the wire must serialize as `ApiBody`** for documented application JSON endpoints.

---

## 10. Conformance

An application is **ApiBod-conformant** when:

- [ ] All documented JSON endpoints return `ApiBody` (except listed exemptions)
- [ ] Server handlers return `ApiBody<T>`, not raw domain objects, for documented JSON endpoints
- [ ] Clients check `status` before reading `data`
- [ ] Clients validate unknown JSON with `isApiBody()`
- [ ] `validation_error` payloads follow `ValidationErrorData`
- [ ] No parallel error shapes (`{ success: false }`, `{ error: "..." }`, etc.)
- [ ] Types are imported from `apibod`, not forked

---

## 11. Ecosystem Position

`apibod` does not compete with full API frameworks; it **standardizes their outward JSON**:

| Tool | Role relative to `apibod` |
|------|---------------------------|
| Express / Fastify / Hono / NestJS | HTTP server; serialize handler result as `ApiBody` |
| Next.js (routes, server actions) | One full-stack consumer; same envelope as plain Node APIs |
| tRPC / oRPC / ts-rest | Internal routing; envelope at HTTP/RPC boundary |
| next-safe-action / zsa | Next.js action plumbing; map results to `ApiBody` |
| neverthrow | Internal `Result`; map to `ApiBody` at edge |
| Zod | Validate `data` field; envelope via `isApiBody` |

---

## 12. Versioning

| Change | Semver |
|--------|--------|
| New `ApiStatus` literal | minor |
| New optional field on envelope | minor |
| New `v: 2` envelope | major (v1 remains supported) |
| HTTP mapping change | major |

---

## 13. Implementation Roadmap (library repo only)

### Phase 1 — v1.0.0 publish

- [ ] Types, constants, guards
- [ ] `PROTOCOL.md` + README
- [ ] JSON Schema
- [ ] Vitest: guard edge cases, HTTP map coverage
- [ ] CI: build, test, npm publish dry-run
- [ ] npm publish

### Phase 2 — Documentation & examples

- [ ] Node.js examples: Express, Fastify, Hono (plain HTTP)
- [ ] Client examples: `fetch` (browser + Node), axios adapter pattern
- [ ] Next.js examples: Route Handler + server action (documented as **one** consumer, not the default)
- [ ] Conformance checklist in README
- [ ] Comparison with `{ success, data }` and JSON-RPC patterns

### Phase 3 — Optional sibling packages (separate repos)

- [ ] `@apibod/eslint` — enforce imports and response shapes
- [ ] `@apibod/contract-tools` — OpenAPI from `ApiEndpoint` maps
- [ ] `@apibod/express` / `@apibod/fastify` — thin `sendApiBody` helpers (peer: respective framework)
- [ ] `@apibod/node` — `STATUS_CODES` helpers, reason phrases (peer: `node` ≥ 18)
- [ ] `@apibod/next` — optional Next.js wrappers (peer: `next`) — **not** required for core usage

None of Phase 3 blocks v1.0.0 of the core spec package.

---

## 14. Success Criteria (library)

- [ ] Zero runtime dependencies
- [ ] `isApiBody` rejects common alternate shapes (`{ success: true }`, tRPC errors, bare `{ error: string }`)
- [ ] `PROTOCOL.md` alone is enough for a third-party client author
- [ ] Package usable from Node.js 18+, browsers, Bun, Deno, and Edge without polyfills
- [ ] No import of `next`, `react`, or any HTTP framework in core source
- [ ] README leads with plain Node.js HTTP example; Next.js listed under “Framework integrations”
- [ ] Published to npm under chosen name

---

## 15. Future Consumer Adoption (out of scope for library repo)

Separate effort in any application that chooses to adopt:

1. Add `apibod` to `dependencies`
2. Delete local duplicate types (`ApiBody`, `ApiStatus`, etc.)
3. Point existing route/action/client wrappers at `apibod` imports
4. Keep app-specific wrappers (auth, logging, framework glue) in the app
5. Align internal API docs with shipped `PROTOCOL.md`

No consumer migration is required for the library to ship or reach v1.0.0.

---

## 16. Non-Goals

- Requiring Next.js, React, or Server Actions for core usage
- Embedding framework-specific implementations in the core package (Next.js belongs in optional `@apibod/next` only)
- Any transitive dependency
- Prescribing auth, ORM, validation library, or HTTP client
- Request envelope in v1
- Replacing RPC wire protocols (tRPC JSON-RPC, etc.) — only standardizing app-facing JSON when desired

---

## 17. References

### Similar patterns in the wild (informative, not dependencies)

- [next-safe-action](https://next-safe-action.dev) — server action ergonomics (different response shape)
- [ts-rest](https://ts-rest.com) — contract-first REST (HTTP-status-keyed responses)
- [oRPC](https://orpc.dev) — typed procedures + OpenAPI
- [next-zod-route](https://github.com/Melvynx/next-zod-route) — validated route handlers
- [neverthrow](https://github.com/supermacro/neverthrow) — `Result` type for handler internals

### RFC-style keywords

This document uses **MUST**, **SHOULD**, **MAY** as defined in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).
