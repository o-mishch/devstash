# Improve Checklist

Apply these lenses across the full changeset. Analysis can be codebase-wide; the edit-scope rule is in SKILL.md § Shared Rules.

## Contents

- How to read code here — reviewer stance and the edge cases to enumerate
- Rule compliance — which rules to audit against, and how to cite them
- P1 Architecture · P2 KISS and DRY · P3 Security and Access · P4 Bugs, Regressions, and Logging · P5 Convention, Hygiene, and Tests
- Severity and confidence — how to grade and when to surface a low-confidence finding

## How to read code here

Be adversarial. Assume each change is hiding a bug, a leak, or a duplicated rule until you have traced it and proven otherwise. Read past the diff into the surrounding function — an edit is wrong as often because of an invariant it silently breaks nearby as because of the line itself. Do not pass a function on a glance; either raise a finding or be able to say the specific reason it is safe.

For every changed function, walk these and treat an unhandled one as a finding unless you can name why it cannot occur:

- Inputs at the extremes: null/nil, undefined or the zero value, empty string, empty array/object/slice/map, `0`, negative, very large, duplicate, and untrusted/attacker-shaped values.
- The unhappy path: the throw, the rejected promise, the 4xx/5xx branch, the early return — does it leave state half-written, a lock held, a loader spinning, or an error swallowed?
- Concurrency and ordering: two callers at once, a retried webhook, an out-of-order event, a check-then-write gap (TOCTOU).
- Async correctness — walk the async signals in P4 — plus a missing transaction or multi-statement write that should be one statement.
- Data the user supplies but you did not validate, and data you return that you should not.

## Rule Compliance

Audit against every rule file `resolve-context.sh improve` listed under "Rule files to read", plus the ones it lists as already in your context — those bind too, you just don't need to open them. Any deviation from a rule is a finding.

- Major: rules phrased as must/never, security, architecture, database, or API contract violations.
- Minor: soft convention or hygiene issues.
- Cite the rule file and section in each rule-compliance finding.
- Honor `context/current-feature.md` when it explicitly supersedes a standing rule for files in scope.
- The rule files are the only source of truth for what a rule says. A bullet here may name the mechanism a stack uses — where to look — but never what its rule requires or forbids. Quote the rule; do not paraphrase it from memory.

## P1 - Architecture

Check whether logic lives in the correct layer and whether a simpler structure would remove debt.

Layer boundaries are defined by the governing rule for each changed path, not by a list here. Audit each changed file against its rule. There is deliberately no path list in this file: a copy drifts from the rule and starts producing both false positives and misses.

Stack-independent signals:

- Access checks, validation, or data access living in UI/presentation code.
- A trust boundary crossed without a mechanism enforcing it — a secret-holding module reachable from an untrusted context with nothing that fails the build or the request.
- Flow spread across too many files for the behavior it implements.
- Circular imports or tight coupling between unrelated modules.

## P2 - KISS and DRY

Work hardest here. Simpler means fewer concepts and less indirection, not always fewer lines. DRY means one source of truth.

Signals:

- Same guard, conditional, transform, schema shape, error map, token flow, or display rule appears in 2+ places. A near-duplicate that differs by one line still counts — name the abstraction that unifies them.
- Changed code reimplements something the stack already provides. Before accepting any new utility, search the codebase for one that already does it.
  - `src/` — an existing helper, hook, schema, route wrapper, Zustand store, TanStack Query pattern, shadcn primitive, Prisma feature, Zod feature, or Next.js primitive.
  - `web/` — an existing `web/src/lib` helper, hook, Zustand store, TanStack Query/Router pattern, `web/src/components/ui` primitive, Zod feature, or a generated `web/src/client` operation.
  - `backend/` — an existing `internal/` helper, a Huma feature, a sqlc query already in `db/queries/**`, or a stdlib built-in.
- One-use wrapper, one-export file, unused generic, premature abstraction, pass-through prop, or deep import chain.
- A flag, option, branch, or parameter that no caller exercises, or that exists only to serve a hypothetical future.
- Net LOC growth without equivalent removed code; a 30-line change that a built-in or existing helper does in 3.
- State that a derived value would compute, or an effect doing what render-time computation or the framework's own data loading already does.
  - `src/` — a client component that could be a server component with less state or fewer props.
  - `web/` — there are no server components in this workspace. Data-loading idioms are not yet standing rules (`web-architecture.md § web/ — Vite SPA`); do not file one as a rule deviation.
- A comment explaining what the code does (rather than why) because the code is harder to read than it needs to be.

## P3 - Security and Access

Look for leaks, auth bypasses, IDOR, and wrong grant or deny states.

Signals:

- Missing auth/session check in API routes, actions, auth flows, or webhooks.
- `userId` accepted from user input instead of session context.
- Request body, query, path params, or form data used without server-side schema validation.
  - `src/` — no Zod schema on the input.
  - `backend/` — no Huma struct tag and no `Resolver` covering the field.
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
- Floating promise; `await` in `.forEach`; an async `.map` never gathered by `Promise.all`; or a `Promise.all` that should be sequential (or vice versa).
- API response shape, status code, or field nullability changed without updating callers and tests.
- A value narrowed or cast (`as`, `!`) where the runtime value can actually be the excluded one.
- Multi-step user flow has no recovery path; an error leaves the UI stuck (loader never clears, optimistic update never rolls back).
- Equality/identity bug: comparing objects by reference, `===` on values that can differ by type coercion, date/timezone handling, or float precision.
- Two concurrent or retried executions produce a wrong result (double-charge, double-insert, lost update).
- Assertions were removed or weakened; a test now asserts less than the behavior it names, or passes for the wrong reason.
- Critical auth, payment, webhook, or write path swallows errors without `log.error`.
- Logging deviates from the stack's logger:
  - `src/` — Pino via `@/lib/infra/pino`; audit the call shape against `legacy-coding-standards.md § Logging`.
  - `backend/` — `log/slog` via `internal/logging`; audit the call shape against `go-coding-standards.md § Logging`, which states the argument order and warns against carrying `src/`'s across.
  - `web/` — browser code has no logger. Console output is governed by `web/.oxlintrc.json`'s `no-console` allowlist and enforced by the lint gate, so it is not an audit lens; the only finding here is a `console.warn`/`console.error` standing in for real error handling.
- Noisy logs, wrong level, custom logger wrappers, or a key state change / external call with no log at all.

## P5 - Convention, Hygiene, and Tests

Check project conventions and proof.

Conventions are stated by the governing rule for each changed path — audit against it and treat any deviation as a finding, whether or not it appears below.

Test expectations are per-stack. Read the testing rule governing the changed path before calling a test gap a finding — do not assume one policy covers the repo, and do not assume "no test" is a finding. Where a stack ships no tests by decision, absence of tests is not a finding; a change that defeats that stack's actual gates is.

- Tests that exist but do not earn their name: only the happy path, no error/edge case, over-mocked so they assert the mock instead of the behavior, or a snapshot standing in for a real assertion.
- A generated artifact hand-edited instead of regenerated. The governing rule for each changed path names them and their generator.
- Dead code shipped in the changeset: unused export, unreachable branch, leftover `console.*` or `fmt.Print*`, commented-out block, or `TODO`/`FIXME` with no follow-up.

The test and generated-artifact heuristics are audit lenses no rule file states — file them without a rule citation. Dead code is rule-stated for `src/` and `web/` only (`typescript-standards.md § Code Quality`); cite it there. No rule states a dead-code standard for `backend/`, so a Go finding here is an audit lens too — file it with no `Rule:` line rather than citing `go-coding-standards.md`, which does not cover it.

## Severity and confidence

Major examples: bug, regression, security risk, trust-boundary leak (in `src/`, a server-only module reachable from the client bundle), IDOR, API contract violation, a rule duplicated across 2+ files (a guard, limit, price, permission, or error map), missing critical-path tests where that stack's testing rule requires them, swallowed critical error, unhandled edge case on a write or auth path.

Minor examples: local simplification, non-critical convention issue, hygiene cleanup, an unnecessary client component (`src/`), or a test gap outside a critical path.

Confidence is separate from severity. Mark each finding high/medium/low by how sure you are it is real, and report low-confidence findings too — say what you could not verify and what would confirm it. A serious-but-uncertain issue (high severity, low confidence) is exactly the kind of thing a shallow review drops; surface it. Do not let low confidence talk you out of a finding, and do not inflate confidence to look decisive.
