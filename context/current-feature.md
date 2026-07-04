# Current Feature

## Status
Not Started

## Goals
- Decide whether to adopt `vitest-mock-extended` and, if so, scope the migration precisely (which files/patterns it touches, which it doesn't)
- Do **not** delete or replace `src/test/matchers.ts` as part of this — research shows it isn't superseded (see Notes)

## Notes

### Research: can a well-known lib replace `src/test/matchers.ts`?

`src/test/matchers.ts` wraps Vitest's asymmetric matchers (`expect.objectContaining`, `arrayContaining`, `stringContaining`, `anything`, `expect.any`) plus a `readJson<T>()` helper, purely to satisfy `@typescript-eslint/no-unsafe-assignment` — Vitest types these as `(expected: any) => any`.

- Checked Vitest v3.2 / v4.0 / v4.1 docs (via Context7): `expect.objectContaining` (and siblings) are **still typed `any`** in the latest release — no built-in fix, so the wrapper file remains necessary as-is.
- `vitest-mock-extended` (`/eratio08/vitest-mock-extended`) does **not** solve the same problem. It's a deep, type-safe **mocking** library (`mock<T>()`, `mockDeep<T>()`) for interface mocks, with its own matcher set (`any()`, `anyString()`, `anyObject()`, `anyArray()`, `includes()`, `isA()`, `captor()`, custom `MatcherCreator`) — but those matchers are designed for use with its own `.calledWith()` API on its mock proxies, not as a drop-in for `expect.objectContaining(...)` inside `toHaveBeenCalledWith()`/`toEqual()` on plain `vi.fn()` / `vi.mock()` mocks (our current pattern per `testing.md`).
- Adopting it would mean replacing `vi.mock('@/lib/infra/prisma', ...)` + `vi.fn()` call-matching throughout `src/**/*.test.ts` with `mock<T>()`/`mockDeep<T>()` + `.calledWith()` — a much larger, separate migration, not a 1:1 swap for `matchers.ts`.

### Scope for a `vitest-mock-extended` follow-up (if pursued)

- Keep `src/test/matchers.ts` untouched regardless — it stays needed for `toEqual`/`toHaveBeenCalledWith` typed-matcher usage even if `vitest-mock-extended` is adopted for mocking.
- Follow-up would cover: introducing `mock<T>()`/`mockDeep<T>()` for Prisma/service interface mocks in `src/**/*.test.ts`, evaluating `.calledWith()` vs current `vi.fn().mockResolvedValue(...)` + assertion style, and whether it reduces boilerplate enough to justify a new dependency + touching every test file in `testing.md`'s scope.
- Needs an explicit user decision before starting `start` — this is a cross-cutting test-infra change, not a small fix.
