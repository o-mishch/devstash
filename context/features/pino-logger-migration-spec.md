# Pino Logger Migration

> **Status:** Specification — not yet implemented  
> **Scope:** Replace custom `src/lib/logger.ts` with [Pino](https://getpino.io/) while preserving the existing public API  
> **Resolves:** Cleanup audit **P4-7** (logger drops Error stacks in production)

---

## 1. Overview

DevStash uses a hand-rolled `console.*` wrapper (`createLogger`, `toErrorMessage`) in **~45 server-side modules** (actions, API routes, billing, auth, cache). It works for local dev but has limitations:

| Gap | Current behavior | Pino fix |
|-----|------------------|----------|
| Production errors | `Error` context serialized to message string only; stacks dropped | Built-in `err` serializer preserves `message`, `stack`, `type` in JSON |
| Log structure | Flat `[tag] LEVEL msg \| key=value` strings | NDJSON with queryable fields (`tag`, `userId`, `eventId`, …) |
| Dev formatting | Custom ANSI + timestamp logic (~80 lines) | `pino-pretty` transport (maintained, configurable) |
| Caller auto-tag | `Error().stack` parsing — brittle under Next.js bundling | Removed; all production call sites already pass explicit tags |
| Aggregator compatibility | String parsing required | One JSON object per line (Vercel, Datadog, etc.) |

**Non-goals for this feature:**

- OpenTelemetry / `@vercel/otel` setup (orthogonal; can follow later)
- Migrating every call site to native Pino API (`log.info({ ctx }, 'msg')`) — optional Phase 2
- Client-side structured logging

---

## 2. Goals

1. Swap implementation to Pino with **zero call-site changes** in Phase 1 (backward-compatible wrapper).
2. Preserve exported API: `createLogger(tag)`, `toErrorMessage(err, fallback?)`.
3. Preserve method signature: `info | warn | error(message, context?, description?)`.
4. Dev: human-readable colored output. Prod: structured NDJSON to stdout/stderr.
5. Keep existing Vitest mock pattern: `vi.mock('@/lib/logger', () => ({ createLogger: () => ({ info: vi.fn(), … }) }))`.
6. Mark logger as **server-only**; fix the one client-component import.

---

## 3. Dependencies

```bash
npm install pino
npm install -D pino-pretty
```

| Package | Role |
|---------|------|
| `pino` | Runtime logger (production dependency) |
| `pino-pretty` | Dev-only transport for readable terminal output |

No peer dependency on Next.js. Pino runs in the Node.js runtime only.

---

## 4. Environment Variables

Add to `.env.example`:

| Variable | Default | Purpose |
|----------|---------|---------|
| `LOG_LEVEL` | `info` | Pino level: `trace` \| `debug` \| `info` \| `warn` \| `error` \| `fatal` |

`NODE_ENV=development` continues to control pretty-print transport (not a new env var).

---

## 5. Implementation

### 5.1 Rewrite `src/lib/logger.ts`

**Add** `import 'server-only'` at the top — Pino must not ship to client bundles.

**Root logger** (singleton):

```typescript
import 'server-only'
import pino from 'pino'

const root = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  ...(process.env.NODE_ENV === 'development' && {
    transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
  }),
})
```

**`createLogger(tag: string)`** — `tag` becomes **required** (see §5.3). Returns a child logger:

```typescript
export function createLogger(tag: string): ScopedLogger {
  const child = root.child({ tag })
  return {
    info: (message, context, description) => logAt(child, 'info', message, context, description),
    warn: (message, context, description) => logAt(child, 'warn', message, context, description),
    error: (message, context, description) => logAt(child, 'error', message, context, description),
  }
}
```

**`logAt` helper** — maps current 3-arg API to Pino's `(bindings, msg)` style:

| `context` type | Pino bindings |
|----------------|---------------|
| `undefined` / `null` | `{}` |
| `Error` instance | `{ err: context }` — triggers `stdSerializers.err` |
| plain object | spread as bindings; normalize nested `error` / `err` keys to `Error` where present |
| primitive | `{ value: context }` |

| `description` | Append to message: `` `${message} | ${description}` `` (preserves Stripe webhook doc strings) |

**`toErrorMessage`** — unchanged; stays exported from this module (used by `src/lib/api-fetch.ts`).

### 5.2 Production output shape

Example — current call:

```typescript
log.error('Webhook handler failed', { handlerName, error })
```

Production NDJSON (illustrative):

```json
{"level":50,"time":1717948800000,"tag":"stripe-billing","handlerName":"handleInvoicePaid","err":{"type":"Error","message":"…","stack":"…"},"msg":"Webhook handler failed"}
```

Dev output (via `pino-pretty`): colored, timestamped, readable — replaces custom ANSI code.

### 5.3 Drop `callerTag()` auto-detection

- Production code **always** passes an explicit tag (`createLogger('stripe-billing')`, etc.).
- Only `src/lib/logger.test.ts` calls `createLogger()` without a tag.
- Make `tag` required in the type signature; update tests to pass `'logger.test'` explicitly.

### 5.4 Client component fix

`src/components/items/item-create-dialog.tsx` (`'use client'`) imports `createLogger`. After `server-only` guard this will fail at build time.

**Fix:** Remove logger import from the client component. The orphaned-file delete failure is already surfaced via `result.message` in the log string — replace with `console.error` in the client catch path, or drop logging entirely (user sees toast; server action logs the failure server-side).

---

## 6. Files to Change

| File | Change |
|------|--------|
| `package.json` | Add `pino`; devDep `pino-pretty` |
| `.env.example` | Document `LOG_LEVEL` |
| `src/lib/logger.ts` | Pino implementation (replace custom formatter) |
| `src/lib/logger.test.ts` | Assert Pino-backed behavior; require explicit tag |
| `src/components/items/item-create-dialog.tsx` | Remove `createLogger` import |
| `src/types/env.d.ts` | Optional: type `LOG_LEVEL` |

**No changes required** to the ~40 server modules that import `createLogger` / `toErrorMessage`, or to test mocks that stub `@/lib/logger`.

---

## 7. Test Plan

### 7.1 `src/lib/logger.test.ts`

Update assertions for Pino output:

| Test | Approach |
|------|----------|
| Explicit tag appears in output | Spy `pino` child or capture stdout; assert `tag` binding |
| Context object fields | Assert bindings (`userId`, `itemId`, …) appear in JSON |
| `Error` context | Assert `err.stack` present in production mode (fixes P4-7) |
| `description` third arg | Assert appended to `msg` |
| `toErrorMessage` | Unchanged |
| Dev pretty mode | Stub `NODE_ENV=development`; smoke-test no throw (avoid brittle ANSI assertions) |

### 7.2 Existing suite

```bash
npm run test:run
```

All modules that `vi.mock('@/lib/logger', …)` should pass unchanged — the mock intercepts before Pino loads.

### 7.3 Manual smoke

```bash
npm run dev
# Trigger: sign-in failure, item create, Stripe webhook (stripe listen)
# Verify: colored pretty logs in terminal

NODE_ENV=production npm run build && npm run start
# Verify: one JSON line per log; Error stacks in err object
```

---

## 8. Phase 2 (Optional, Out of Scope)

Gradually adopt native Pino style at high-traffic call sites:

```typescript
// Before (wrapper)
log.info('Webhook processed', { eventId: event.id, eventType: event.type })

// After (native)
log.info({ eventId: event.id, eventType: event.type }, 'Webhook processed')
```

Benefits: idiomatic Pino, slightly less adapter overhead. Do file-by-file when touching billing/auth code anyway — not part of initial migration.

---

## 9. Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| `pino-pretty` in production bundle | Guard transport behind `NODE_ENV === 'development'` only |
| Next.js worker threads / edge | Logger is `server-only`; edge routes must not import it (none do today) |
| Log volume increase (JSON metadata) | Pino is low-overhead; `LOG_LEVEL` tunable per environment |
| Test output noise | Tests mock `@/lib/logger`; `logger.test.ts` uses spies |
| Breaking `createLogger()` without tag | TypeScript error + one test file update |

---

## 10. Acceptance Criteria

- [ ] `pino` installed; `pino-pretty` devDependency
- [ ] `src/lib/logger.ts` uses Pino; exports unchanged (`createLogger`, `toErrorMessage`)
- [ ] `import 'server-only'` on logger module
- [ ] Client component no longer imports logger
- [ ] `callerTag()` removed; `tag` required
- [ ] Production logs emit NDJSON with `err.stack` for Error context (**P4-7** resolved)
- [ ] Dev logs human-readable via `pino-pretty`
- [ ] `npm run test:run` passes
- [ ] `npm run lint` passes
- [ ] `.env.example` documents `LOG_LEVEL`

---

## 11. References

- Pino child loggers: https://getpino.io/#/docs/child-loggers
- Pino pretty printing: https://getpino.io/#/docs/pretty
- Pino error serializer: `pino.stdSerializers.err` (default)
- Cleanup audit: `context/cleanup-audit.md` — P4-7
