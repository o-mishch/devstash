# Review Action

## 1. Parse Requirements from the Feature Doc

Read `context/current-feature.md`. The doc may be in two formats — handle both:

**Clean format** (produced by `load` action): has a `## Goals` section with bullet points. Use those directly.

**Rich format** (planning doc): no Goals section; requirements are embedded in phases, before/after code blocks, and delete/remove lists. Extract by scanning for:
- Lines with `Delete:`, `Remove:`, `Uninstall:`, or `Deleted:`
- Before/After code blocks — the After block is the exact correctness target; save it, you will compare against it in Step 2
- Phase completion items like "Migrated X to use Y"
- New file paths listed as created

**Scope:** verify everything the doc marks as complete or planned. If the doc has multiple phases, cover all of them — partial review is not a review.

Do not rely on the doc's own `✅` checkmarks — they record intent, not actuality.

## 2. Verify Each Requirement Delivers Its Outcome

**The question is not "does this pattern exist?" — it is "does the code actually deliver what was required?"**

Use grep to navigate to the right file/line. Then **read the implementation** to verify correctness.

### What to verify when reading

For each requirement, ask: what would a broken implementation look like?
- A migration that imported the new hook but still calls the old one under it
- A `'use cache'` directive present but `cacheTag` called with wrong arguments
- A component using `useInfiniteItems` but ignoring `initialData`, breaking SSR hydration
- A deleted file that is still imported somewhere else
- A store that is created but not initialized before components read it

Read enough of the implementation to rule those out.

### Migrations ("X replaced by Y everywhere")

1. Grep old pattern to find the full set of files that were supposed to change
2. For each file: read the implementation at that site
   - If the feature doc has a Before/After block for this migration, compare the actual code against the After block directly — that is the correctness target, not your judgment
   - If no After block exists, verify: new pattern imported, called with correct arguments, return values used, old pattern absent
3. Any file still using the old pattern, or diverging from the After block → BLOCKER

### New files / patterns

Navigate with grep, then read the relevant section. Verify the implementation is complete and correct — not just that the symbol is present.

### Deletions

Grep for the deleted file path and its exports across the codebase. If anything still imports from it → BLOCKER.

### Bulk operations (e.g., "applied to N functions in file.ts")

Read a sample of the implementations, not just count occurrences. Verify the pattern is applied correctly in each, not just present.

## 3. Run Objective Checks

```bash
npm run lint
npm run test:run
```

Both must pass. This is a report-only action — do not fix failures, just record them as BLOCKERs.

## 4. Report

### Requirements

One line per requirement (bulk operations may be grouped):

- ✅ `description` — `file:line` (read: what was verified)
- ✅ `N/N functions in file apply <pattern>` — sampled `file:line`, shape matches spec
- ❌ `description` — **BLOCKER**: `file:line` — what is wrong
- ❌ `deleted file still imported` — **BLOCKER**: `file:line`

### Objective Checks

- ✅ / ❌ `npm run lint`
- ✅ / ❌ `npm run test:run` — N tests

### Verdict

**Ready to complete** — all requirements verified correct, lint and tests pass.

**Needs work** — list each BLOCKER.
