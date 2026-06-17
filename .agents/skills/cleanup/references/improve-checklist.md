# Improve Checklist

Use this reference only for `cleanup improve`.

Apply these lenses across the full changeset. Analysis can be codebase-wide; edits stay scoped to the changed files plus one shared helper when needed to remove duplication.

## How to read code here

Be adversarial. Assume each change is hiding a bug, a leak, or a duplicated rule until you have traced it and proven otherwise. Read past the diff into the surrounding function — an edit is wrong as often because of an invariant it silently breaks nearby as because of the line itself. Do not pass a function on a glance; either raise a finding or be able to say the specific reason it is safe.

For every changed function, walk these and treat an unhandled one as a finding unless you can name why it cannot occur:

- Inputs at the extremes: null, undefined, empty string, empty array/object, `0`, negative, very large, duplicate, and untrusted/attacker-shaped values.
- The unhappy path: the throw, the rejected promise, the 4xx/5xx branch, the early return — does it leave state half-written, a lock held, a loader spinning, or an error swallowed?
- Concurrency and ordering: two callers at once, a retried webhook, an out-of-order event, a check-then-write gap (TOCTOU).
- Async correctness: every promise awaited, no `await` inside `.map`/`.forEach`, no floating promise, no missing transaction around a multi-row write.
- Data the user supplies but you did not validate, and data you return that you should not.

A finding can be low-confidence. Surface it anyway, marked as such — a false alarm costs a sentence, a missed bug ships. Do not merge two distinct problems to shorten the list, and do not downgrade severity to make the report read calmer.

## Rule Compliance

Read every file under `.agents/rules/*` before scanning. Any deviation from a rule is a finding.

- Major: rules phrased as must/never, security, architecture, database, or API contract violations.
- Minor: soft convention or hygiene issues.
- Cite the rule file and section in each rule-compliance finding.
- Honor `context/current-feature.md` when it explicitly supersedes a standing rule for files in scope.

## P1 - Architecture

Check whether logic lives in the correct layer and whether a simpler structure would remove debt.

Signals:

- Client files importing server-only modules from `src/lib/db`, `src/lib/infra`, `src/lib/auth`, `src/lib/billing`, `src/lib/storage`, `src/lib/stripe`, `src/lib/session.ts`, or `src/lib/api/index.ts`.
- Server-only modules missing `import 'server-only'` as the first line.
- `prisma.*` outside `src/lib/db/`, except the allowed `src/auth.ts` NextAuth adapter case.
- Access checks, validation, DB calls, or Stripe calls living in UI components.
- Flow spread across too many files for the behavior it implements.
- Circular imports or tight coupling between unrelated modules.

## P2 - KISS and DRY

Work hardest here. Simpler means fewer concepts and less indirection, not always fewer lines. DRY means one source of truth.

Signals:

- Same guard, conditional, transform, schema shape, error map, token flow, or display rule appears in 2+ places. A near-duplicate that differs by one line still counts — name the abstraction that unifies them.
- Changed code reimplements an existing helper, hook, schema, route wrapper, Zustand store, TanStack Query pattern, shadcn primitive, Prisma feature, Zod feature, or Next.js primitive. Before accepting any new utility, search the codebase for one that already does it.
- One-use wrapper, one-export file, unused generic, premature abstraction, pass-through prop, or deep import chain.
- A flag, option, branch, or parameter that no caller exercises, or that exists only to serve a hypothetical future.
- Net LOC growth without equivalent removed code; a 30-line change that a built-in or existing helper does in 3.
- A client component can become a server component with less state or fewer props; `useEffect` doing what a derived value or server fetch could do.
- A comment explaining what the code does (rather than why) because the code is harder to read than it needs to be.

Every P2 finding must include an estimated LOC delta and the lowest-LOC fix path.

## P3 - Security and Access

Look for leaks, auth bypasses, IDOR, and wrong grant or deny states.

Signals:

- Missing auth/session check in API routes, actions, auth flows, or webhooks.
- `userId` accepted from user input instead of session context.
- Request body, query, path params, or form data used without Zod validation.
- Token is weak, reusable, unhashed at rest when sensitive, or missing server-side expiry.
- Password hash logged, returned, or changed without verifying the current password when required.
- New auth-adjacent endpoint without rate limiting.
- Webhook without signature verification or idempotency.
- Internal errors, stack traces, secrets, or hashes exposed to clients.
- Cache invalidation missing after a write that affects access or billing.
- Authorization confused with authentication: the session is checked but ownership of the specific resource is not (any logged-in user can act on another user's row).
- Existence check and write split across two statements where a unique constraint or transaction is the only safe guard (TOCTOU).
- Enumeration: a response, timing, or error message that reveals whether an email/account exists when the flow is meant to be enumeration-safe.
- Trusting a client-supplied total, price, role, plan, or `id` instead of deriving it server-side.
- A redirect, link, or template built from unvalidated user input (open redirect, injection).

## P4 - Bugs, Regressions, and Logging

Look for behavior breaks and production diagnostics gaps.

Signals:

- Wrong branch, off-by-one, inverted condition, null/empty edge, partial write without transaction, stale cache, or missing await.
- Floating promise, `await` inside `.map`/`.forEach`, or a `Promise.all` that should be sequential (or vice versa).
- API response shape, status code, or field nullability changed without updating callers and tests.
- A value narrowed or cast (`as`, `!`) where the runtime value can actually be the excluded one.
- Multi-step user flow has no recovery path; an error leaves the UI stuck (loader never clears, optimistic update never rolls back).
- Equality/identity bug: comparing objects by reference, `===` on values that can differ by type coercion, date/timezone handling, or float precision.
- Two concurrent or retried executions produce a wrong result (double-charge, double-insert, lost update).
- Assertions were removed or weakened; a test now asserts less than the behavior it names, or passes for the wrong reason.
- Critical auth, payment, webhook, or write path swallows errors without `log.error`.
- Pino calls are not bindings-first/message-second or do not wrap errors as `{ err: error }`.
- Noisy logs, wrong level, custom logger wrappers, or a key state change / external call with no log at all.

## P5 - Convention, Hygiene, and Tests

Check project conventions and proof.

Signals:

- Inline object types where named interfaces/types are required.
- `any`, stale `@ts-ignore`, custom `Error` subclass, or control flow based on `error.name`.
- React class component, inline props type, nested ternary, `React.` namespace type, or unjustified direct `window`/`document`.
- Tailwind config file, inline styles, redundant `cursor-pointer`.
- Raw API response or client fetch that violates `api-contract.md`.
- Changed non-DB `src/lib/**/*.ts` or `src/actions/*.ts` without meaningful tests.
- Tests that exist but do not earn their name: only the happy path, no error/edge case, over-mocked so they assert the mock instead of the behavior, or a snapshot standing in for a real assertion.
- `openapi.json` or `src/types/openapi.ts` edited by hand instead of generated.
- Dead code shipped in the changeset: unused export, unreachable branch, leftover `console.*`, commented-out block, or `TODO`/`FIXME` with no follow-up.

## Severity and confidence

Major examples: bug, regression, security risk, FE/BE bundle leak, IDOR, API contract violation, duplicated business rule across 2+ files, missing critical-path tests, swallowed critical error, unhandled edge case on a write or auth path.

Minor examples: local simplification, non-critical convention issue, hygiene cleanup, unnecessary client component, or a test gap outside a critical path.

Confidence is separate from severity. Mark each finding high/medium/low by how sure you are it is real, and report low-confidence findings too — say what you could not verify and what would confirm it. A serious-but-uncertain issue (high severity, low confidence) is exactly the kind of thing a shallow review drops; surface it. Do not let low confidence talk you out of a finding, and do not inflate confidence to look decisive.
