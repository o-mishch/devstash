# Improve Report Template

## Contents

- The template itself — the exact section order to render, from At a glance through Summary
- Report rules (below the template) — how to set `Overall`, sort and cite findings, and when `No issues found` is permitted

Omit empty sections, **except Coverage and Housekeeping** — those two are the proof the audit ran, and an omitted proof reads as a passed one. Keep the report user-facing and concise.

```markdown
# Code quality audit

[date] - [N] files reviewed across [G] groups - [new] new, [known] known, [fixed] fixed since last run

## At a glance

| | |
| --- | --- |
| Overall | Clean / Needs attention / Critical issues |
| Major | N |
| Minor | N |
| LOC changed | +A -B, net C (as printed by `resolve-context.ts improve`) |
| Audit scope | N files / N LOC hand-written (excludes N generated, N not-lensed) |
| KISS opportunities | N, est. net [+/-]X lines |

[One sentence with the biggest takeaway.]

## What you're shipping

[Two or three sentences describing the changeset as one solution.]

## Coverage

Never omit this. It is what makes an incomplete audit visible instead of silent.

| | |
| --- | --- |
| Groups planned / reviewed | N / N |
| Files proven read | N of N |
| Units run | N (G groups x 2 units [P3, P4+P5] + 2 cross-cutting) |
| Detectors | duplication: ran / **did not run** · import graph: ran · inventory: ran |
| Quick tier | Yes — Verify skipped / No |
| Agents | N ran · E errored · S skipped (from the Workflow completion's usage block) |
| Run cost | ~N subagent tokens · Xs wall-clock (from the same usage block) |

[If any file was skipped, list it here with the reason. If a detector did not run, say which lens is degraded — a lens whose detector failed is degraded, not clean. If Quick tier is Yes, say so plainly — plan-improve.ts forced every group to a merged unit and no finding below was adversarially refuted; each carries `verification: quick-tier` rather than `survived`/`unverified`.]

**An errored or skipped agent is a coverage gap, not a cost line.** A finder that errored reviewed
its group with nobody — its files will be missing from `covered`, so reconcile the count here against
step 6 and name the unreviewed group, exactly as a skipped file is named. The token/wall-clock figures
are reported so a run's cost is visible rather than guessed; they carry no severity and gate nothing.

## Findings

If there are no findings, write `No issues found.` per the last report rule below. Otherwise every finding appears here exactly once.

Majors render as full cards. Minors collapse into the table below them — the audit is exhaustive by design, so a long minor list is expected and must stay readable.

### P1 - Architecture

**[P1-1] Major - [title]** _(confidence: high · new)_
- Problem: [plain-language issue]
- Evidence: `[file:line]` - [line or shape]
- Why it matters: [impact]
- Fix: [concrete action] - est. LOC: [delta]
- Rule: [governing rule file + section; omit when the finding breaks no rule]
- Unverified: [only for medium/low confidence — what you could not confirm and what would settle it]

### P2 - KISS and DRY

[same card shape as P1]

### P3 - Security and Access

[same card shape as P1]

### P4 - Bugs, Regressions, and Logging

[same card shape as P1]

### P5 - Convention, Hygiene, and Tests

[same card shape as P1]

### Minor findings

| ID | Lens | Location | Issue | Fix | Status |
| --- | --- | --- | --- | --- | --- |
| P2-4 | KISS | `file.ts:42` | [one line] | [one line] | new |

## Housekeeping

| Check | Status | Note |
| --- | --- | --- |
| `context/history.md` order | OK / Issue | [only when Issue] |
| `context/current-feature.md` alignment | OK / Issue | [only when Issue] |
| Prisma migration sync | OK / Issue / N/A | [only when Issue] |
| Env drift | OK / Issue / N/A | [only when Issue] |
| Generated files hand-edited | OK / Issue / Unverifiable | [name the paths that could not be checked offline] |

## Scope reviewed

| Area | Files |
| --- | --- |
| [area — the group's `area`, e.g. `web/src/routes`] | N — then the filenames, comma-separated, when the total is <= 30 |
| Total | N |

When the total exceeds 30, drop the filenames and keep counts only, with the full list in a collapsed `<details>` block below the table.

Also list, in one line each: generated paths (hand-edit check only), not-lensed paths (assets/docs/config), and deleted paths. Nothing in the changeset may be absent from this section.

## Summary

| Area | Major | Minor |
| --- | --- | --- |
| P1 Architecture | 0 | 0 |
| P2 KISS and DRY | 0 | 0 |
| P3 Security and Access | 0 | 0 |
| P4 Bugs, Regressions, and Logging | 0 | 0 |
| P5 Convention, Hygiene, and Tests | 0 | 0 |
| Total | 0 | 0 |

What should I fix? Reply with IDs such as `P2-1`, `all major`, `all minor`, `all`, or `none`.
```

Report rules:

- Set `Overall` from the findings: `Critical issues` if any P3 Major or a data-loss/corruption P4 Major; `Needs attention` if any other Major, or three or more Minor; `Clean` if no Major and at most two Minor. `Clean` is not the same claim as `No issues found` — see the last rule below.
- Findings is the single catalogue. Do not repeat the same finding in multiple sections.
- Sort findings by P1 through P5, then Major before Minor.
- Every finding needs a concrete fix and an estimated LOC delta. `Fix` is the simplest path that works — fewest concepts and least indirection, which is usually but not always the fewest lines. Add `Leaner option` only when a smaller-LOC path exists and you rejected it, and say what the extra lines buy.
- Every finding carries a confidence (high/medium/low); medium/low findings need an `Unverified` line. The rubric is `improve/common.md § Severity and confidence`.
- Every finding carries a ledger status: `new`, `known`, or `fixed`. The ledger (`context/cleanup-findings.md`) is a cache, never a source of truth — the codebase is. A `known` finding is still a real finding; the status says only that a previous run also saw it.
- Each finding carries a `verification` field. `survived` — a refuter attacked it and failed. `skipped-high-confidence` — the finder quoted evidence that settles it, so no refuter was spent; render it as a normal finding with no `unverified` marker. `skipped-medium` — a medium-confidence `web/` or `backend/` finding the Verify stack-tier left unrefuted on purpose (`src/` is never skipped); it keeps its `Unverified` line, and must never render as `survived`. `unverified` — its refuter died; mark it as such rather than dropping it, because silently discarding it is the invisible loss this audit exists to remove. `quick-tier` — the changeset was small enough that the plan skipped Verify entirely (see Coverage's Quick tier row); mark it, never render it as `survived`.
- Every rule-compliance finding needs a rule citation.
- Housekeeping and Coverage are never omitted — an all-`OK` Housekeeping table and a full Coverage table are the proof they ran. `N/A` when the changeset touches no `prisma/` or env file. These rows carry no severity, confidence, or finding ID; if a housekeeping issue is also a code defect, it additionally gets a P-section finding.
- The summary counts must match the findings.
- `No issues found` is a strong claim. Use it only when Coverage shows every planned file was read and every unit ran, and then state what you traced — never as a default for a changeset the audit did not fully cover.
