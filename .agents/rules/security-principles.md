---
trigger: always_on
description: Stack-agnostic security principles for DevStash — IDOR scoping, input validation at the boundary, and token security stated abstractly. Always applied. Stack-specific mechanics live in legacy-security.md (Next.js) and go-coding-standards.md § IDOR and access (Go) — both reference this file rather than restating the principle.
---

# Security Principles

These are the security invariants every stack in this repo must uphold. Stack-specific mechanics — which session helper to call, which error type to return — live in each stack's own rule file; this file states only the *why* and the *what*, so it doesn't drift when the mechanics change.

## IDOR prevention (no exceptions)

Every read or write that touches user-owned data **must** be scoped by the authenticated user's own identity, resolved from the session/auth context — never from user-supplied input (request body, query params, path/route segments).

```
// ✅ correct — identity from session/auth context
where userId == session.userId

// ❌ wrong — identity from user input
where userId == request.params.userId
```

A test suite that asserts this by default-deny (an operation is either scoped or on a reviewed public allowlist) is the strongest form of this guarantee — see `go-coding-standards.md`'s `security_guard_test.go` for the reference implementation.

## Input validation at the boundary

All external input — HTTP bodies, query params, path params, form data — must be validated before use, at the point it crosses into the application. Never trust raw request data past that point. Each stack has its own validation library (Zod for Next.js, Huma struct tags + resolvers for Go); the principle is the same regardless of which one is in play.

## Token security

- Generate security-sensitive tokens (session tokens, one-time verification/reset tokens) with a cryptographically secure random source — never `Math.random()` or an equivalent weak PRNG.
- Store tokens **hashed at rest** where the raw value doesn't need to be recovered (e.g. a SHA-256 digest as the lookup key) — never the raw token.
- Make single-use tokens **atomically single-use** — consume-and-delete in one operation (e.g. Redis `GETDEL`, a compare-and-delete), never read-then-delete as two steps.
- Enforce expiry server-side with a real TTL at issue time, not a client-trusted expiry field.

## Never leak internals to the client

- Do not return stack traces, raw error messages, or other internal detail in an error response. Log the real error server-side; return an opaque message to the caller.
- Do not log, store, or return password hashes or other secrets to the client.
