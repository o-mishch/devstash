# Improve Report Template

## Contents

- The template itself — the exact section order to render, from At a glance through Summary
- Report rules (below the template) — how to set `Overall`, sort and cite findings, and when `No issues found` is permitted

Omit empty sections. Keep the report user-facing and concise.

```markdown
# Code quality audit

[date] - [N] uncommitted files reviewed

## At a glance

| | |
| --- | --- |
| Overall | Clean / Needs attention / Critical issues |
| Major | N |
| Minor | N |
| LOC changed | +A -B, net C (tracked + untracked, as printed by `resolve-context.sh improve`) |
| KISS opportunities | N, est. net [+/-]X lines |

[One sentence with the biggest takeaway.]

## What you're shipping

[Two or three sentences describing the changeset as one solution.]

## Findings

If there are no findings, write `No issues found.` per the last report rule below. Otherwise every finding appears here exactly once.

### P1 - Architecture

**[P1-1] Major - [title]** _(confidence: high)_
- Problem: [plain-language issue]
- Evidence: `[file:line]` - [line or shape]
- Why it matters: [impact]
- Fix: [concrete action] - est. LOC: [delta]
- Rule: [governing rule file + section; omit when the finding breaks no rule]
- Unverified: [only for medium/low confidence — what you could not confirm and what would settle it]

### P2 - KISS and DRY

**[P2-1] Minor - [title]** _(confidence: high)_
- Problem: [plain-language issue]
- Evidence: `[file:line]` - [line or shape]
- Why it matters: [impact]
- Fix: [concrete action] - est. LOC: [delta]
- Leaner option: [only when the primary fix adds lines]
- Rule: [governing rule file + section; omit when the finding breaks no rule]
- Unverified: [only for medium/low confidence — what you could not confirm and what would settle it]

### P3 - Security and Access

[same card shape as P1]

### P4 - Bugs, Regressions, and Logging

[same card shape as P1]

### P5 - Convention, Hygiene, and Tests

[same card shape as P1]

## Housekeeping

| Check | Status | Note |
| --- | --- | --- |
| `context/history.md` order | OK / Issue | [only when Issue] |
| `context/current-feature.md` alignment | OK / Issue | [only when Issue] |
| Prisma migration sync | OK / Issue / N/A | [only when Issue] |
| Env drift | OK / Issue / N/A | [only when Issue] |

## Scope reviewed

| Area | Files |
| --- | --- |
| [area — a top-level workspace or domain dir, e.g. `backend/internal/items`, `web/src/routes`] | N — then the filenames, comma-separated, when the total is <= 30 |
| Total | N |

When the total exceeds 30, drop the filenames and keep counts only, with the full list in a collapsed `<details>` block below the table.

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
- Every finding carries a confidence (high/medium/low); medium/low findings need an `Unverified` line. The rubric is `improve-checklist.md § Severity and confidence`.
- Every rule-compliance finding needs a rule citation.
- Housekeeping renders the output of `improve.md` step 2 and is never omitted — an all-`OK` table is the proof it ran. `N/A` when the changeset touches no `prisma/` or env file. These rows carry no severity, confidence, or finding ID; if a housekeeping issue is also a code defect, it additionally gets a P-section finding.
- The summary counts must match the findings.
- `No issues found` is a strong claim. Use it only after tracing every changed function's edge cases and rule compliance, and then state what you traced — never as a default for a changeset you skimmed.
