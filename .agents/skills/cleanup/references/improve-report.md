# Improve Report Template

Use this template for `cleanup improve`. Omit empty sections. Keep the report user-facing and concise.

```markdown
# Code quality audit

[date] - [N] uncommitted files reviewed

## At a glance

| | |
| --- | --- |
| Overall | Clean / Needs attention / Critical issues |
| Major | N |
| Minor | N |
| LOC in `src/` | +A -B, net C |
| KISS opportunities | N, est. -X lines |

[One sentence with the biggest takeaway.]

## What you're shipping

[Two or three sentences describing the changeset as one solution.]

## KISS - decrease LOC

| ID | Cut / merge / simplify | est. LOC |
| --- | --- | --- |
| P2-1 | [description] | -N |
| | Total recoverable | -N |

## Findings

### P1 - Architecture

**[P1-1] Major - [title]** _(confidence: high)_
- Problem: [plain-language issue]
- Evidence: `[file:line]` - [line or shape]
- Why it matters: [impact]
- Fix: [concrete action] - est. LOC: [delta]
- Rule: [.agents/rules/file.md section]
- Unverified: [only for medium/low confidence — what you could not confirm and what would settle it]

### P2 - KISS and DRY

**[P2-1] Minor - [title]** _(confidence: high)_
- Problem: [plain-language issue]
- Evidence: `[file:line]` - [line or shape]
- Why it matters: [impact]
- Fix: [concrete action] - est. LOC: [delta]
- Leaner option: [only when the primary fix adds lines]
- Rule: [omit for pure KISS suggestions that break no rule]
- Unverified: [only for medium/low confidence — what you could not confirm and what would settle it]

### P3 - Security and Access

[same card shape]

### P4 - Bugs, Regressions, and Logging

[same card shape]

### P5 - Convention, Hygiene, and Tests

[same card shape]

If there are no findings, write: `No issues found.` Then state what was checked.

## Detail tables

Include only when useful.

Security and access:

| ID | Risk | What could go wrong | Fix |
| --- | --- | --- | --- |

Redesign:

| ID | Today | Proposed | Why worth it |
| --- | --- | --- | --- |

SSR:

| ID | File | Current | Can convert? | est. LOC | Verdict |
| --- | --- | --- | --- | --- | --- |

## Scope reviewed

| Area | Files |
| --- | --- |
| [area] | N |
| Total | N |

List files inline when N <= 30. Use a collapsed details block when N > 30.

## Summary

| Area | Major | Minor |
| --- | --- | --- |
| Architecture | 0 | 0 |
| KISS and DRY | 0 | 0 |
| Security and access | 0 | 0 |
| Bugs and logging | 0 | 0 |
| Convention and tests | 0 | 0 |
| Total | 0 | 0 |

What should I fix? Reply with IDs such as `P2-1`, `all major`, `all minor`, `all`, or `none`.
```

Report rules:

- Findings is the single catalogue. Do not repeat the same finding in multiple sections.
- Sort findings by P1 through P5, then Major before Minor.
- Every finding needs a concrete fix and estimated LOC delta.
- Every finding carries a confidence (high/medium/low); medium/low findings need an `Unverified` line. Report low-confidence findings — do not drop a real concern because you could not fully prove it.
- Every rule-compliance finding needs a rule citation.
- The summary counts must match the findings.
- `No issues found` is a strong claim. Use it only after tracing every changed function's edge cases and rule compliance, and then state what you traced — never as a default for a changeset you skimmed.
