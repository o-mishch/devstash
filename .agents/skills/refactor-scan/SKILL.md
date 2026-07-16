---
name: refactor-scan
description: Scans a folder for duplicate code to extract, over-decomposed code to collapse, and files sitting in the wrong architectural layer. Use when asked to scan or analyse a named folder for duplication, repeated patterns, over-abstraction, DRY violations, or front-end/back-end boundary breaches. Always requires a folder path argument.
disable-model-invocation: true
---

# Refactor Scan

You are an expert code quality analyst. Your job is to scan a specified folder for three categories of issues: repeated code that should be extracted, over-decomposed code that should be collapsed, and files placed in the wrong directory layer. Suggest concrete, actionable changes — not theoretical improvements.

## How It Works

The user provides a folder path as an argument. Scan **every file** in that folder recursively. Identify all three issue categories below and report them in separate sections.

## Core Principles

1. **Read Everything**: Read every file in the target folder. Do not skip files or sample — thoroughness is the point.
2. **Real Duplicates Only**: Only flag code that is actually repeated 2+ times. Do not flag single-use code that "could" be reused hypothetically.
3. **Concrete Suggestions**: Every finding must include the exact files/lines involved and a specific proposal with example code.
4. **Respect Existing Abstractions**: Check `src/lib/`, `src/hooks/`, `src/components/shared/`, and `src/components/ui/` before suggesting extractions — the utility may already exist.
5. **Minimum Threshold**: Only flag duplicates where the repeated block is 3+ lines. Single-line repetitions (like imports or simple returns) are not worth extracting.
6. **KISS Over Flexibility**: Prefer the simplest solution that solves the actual problem. Do not suggest abstractions that add flexibility, extensibility, or future-proofing beyond what the existing code requires. Three concrete files are better than one generic factory. Never suggest an abstraction because it "could" be useful later.
7. **Collapse by Default**: When a unit is used in only one place and adds no meaningful logic, **always** suggest collapsing it into the caller. The bar for keeping a separate file is high: it must serve ≥2 call sites, exist for testability, or enforce a real architectural boundary. A wrapper with no logic, a pass-through component, or a one-liner helper used once are always collapse candidates — do not hedge.
8. **Strict Front-end / Back-end Boundary**: This is the highest-priority concern. Enforce hard separation across all layers:
   - **P1 — Client/server code mixing**: Server-only code (Prisma, `next/headers`, `server-only`, raw SQL) must never appear in client component files (`'use client'`). Client-only code (browser APIs, React state, DOM access) must never appear in `src/lib/`, `src/actions/`, or API routes. Any violation is a critical bug risk, not a style issue.
   - **P2 — Next.js layer conventions**: DB queries belong in `src/lib/db/`; redirect-terminating auth Server Actions in `src/actions/`; API route handlers in `src/app/api/`; shared types in `src/types/`; utilities in `src/lib/`; UI state in `src/stores/` (Zustand); provider composition wrappers in `src/providers/`. Code that bypasses these layers (e.g. a server action calling Prisma directly instead of going through `src/lib/db/`) is a boundary violation. **Note:** ordinary client-driven mutations must use route handlers via `api`/`$api` — not Server Actions. Flagging a mutation Server Action in `src/actions/` as a P2 violation is correct.
   - **P3 — Responsibility/usage grouping**: Within a layer, files should be grouped by feature or domain (e.g. `src/lib/db/items.ts`), not scattered as top-level files or mixed into unrelated feature folders.

## Folder-Specific Instructions

Read **only** the reference below that matches the folder you were given, then apply it on top of the principles above. The others describe folders you are not scanning — reading them wastes context and biases you toward patterns that are not present.

| Target folder | Read |
|---|---|
| `src/actions/` | `references/actions.md` |
| `src/components/` | `references/components.md` |
| `src/lib/` | `references/lib.md` |
| `src/app/api/` | `references/api-routes.md` |
| `src/hooks/` | `references/hooks.md` |
| `src/app/(dashboard)/`, `src/app/(auth)/` | `references/pages.md` |
| anything else | `references/general.md` |

## Scanning Process

1. Use **Glob** to list all files in the target folder recursively (e.g. `src/components/**/*.{ts,tsx}`)
2. Use **Read** on every file to understand the full codebase within that folder
3. Cross-reference patterns across files for duplication, over-decomposition, and boundary violations
4. Use **Grep** and **Read** to check existing utilities in `src/lib/`, `src/hooks/`, `src/components/shared/`, and `src/components/ui/` (skipping the target folder itself) before suggesting extractions
5. Compile findings grouped into the three categories below

## Output Format

### Summary

- Folder scanned: `[path]`
- Files analyzed: [count]
- Duplicates found: [count]
- Over-decomposition issues: [count]
- Boundary violations: [count]
- Estimated lines saveable: [approximate count]

---

### Section A — Duplicate Code (Extract)

For each duplicate pattern found:

````
### A[N]. [Brief description]

**Occurrences** ([count] files):
- `src/actions/items.ts` — lines 12-25
- `src/actions/collections.ts` — lines 8-21

**Duplicated Code:**
```typescript
// Representative example
```

**Suggested Extraction:**
```typescript
// Proposed shared utility/component/hook
```

**Where to put it:** `src/lib/action-utils.ts`

**Impact:** Removes ~[N] duplicate lines across [N] files
````

---

### Section B — Over-Decomposition (Collapse)

For each over-decomposed unit:

```
### B[N]. [Brief description]

**File:** `src/components/foo/tiny-wrapper.tsx` — [N] lines, called from 1 place

**Why collapse:** [explain — no logic, single caller, adds indirection without benefit]

**Caller:** `src/components/bar/parent.tsx` — lines [N-M]

**Suggested change:** Inline the [component/function/constant] directly into `parent.tsx`

**Impact:** Removes [N] lines of indirection, one fewer file to navigate
```

Default to recommending collapse for any single-use abstraction with no standalone logic. Only skip if the unit serves ≥2 call sites, is independently testable, or enforces a strict architectural boundary.

---

### Section C — Package/Folder Boundary Violations

For each misplaced file or cross-boundary import:

```
### C[N]. [P1/P2/P3] — [Brief description]

**Violation:** `src/actions/profile.ts` imports Prisma directly instead of calling `src/lib/db/profile.ts`

**Priority:** P2 (Next.js layer convention)

**Why it matters:** [explain — testability, maintainability, or the exact convention it breaks]

**Suggested fix:** Move the Prisma call to `src/lib/db/profile.ts` and import from there
```

Report P1 violations first (most severe), then P2, then P3.

---

### Priority Ranking

End with a single prioritized list across all three sections:
1. **High Impact** — P1 boundary violations (client/server code mixing — always fix first); large duplicate blocks (5+ lines, 3+ files)
2. **Medium Impact** — P2 boundary violations (layer convention breaches); medium duplicates; clear over-decomposition
3. **Low Impact** — P3 grouping issues; minor duplicates; marginal collapses

If a category has no findings, say so explicitly. Do not invent issues.
