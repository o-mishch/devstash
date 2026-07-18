# Verifying a finding (refutation pass)

Your job is to **attack** each candidate finding, not to confirm it. You are given findings the
finder itself marked medium or low confidence — it was unsure, and you settle them. They all sit
in one file: open it, read the surrounding code, and judge each candidate against it.

Judge every candidate on its own evidence. A batch is a way to read the file once, not a verdict
about the file — refuting one candidate is not a reason to doubt the next, and a real finding
sitting beside a refuted one is exactly what a hurried pass loses.

Refute a candidate when any of these hold:

- The described defect cannot actually occur — a guard upstream, a type that excludes the value,
  a caller that cannot reach it.
- The cited rule does not say what the finding claims. Check the rule file itself; a misquoted
  rule is not a violation.
- A rule explicitly **sanctions** the thing. The recurring false positives here:
  - `boundary.md` permits — and expects — copying source from `src/` into `web/`. Duplication
    across those workspaces is the goal, not a DRY finding.
  - `web-architecture.md` states `web/` ships no tests by decision. "Missing tests" is never a
    finding there.
  - `typescript-standards.md` sanctions `as unknown as` at a genuinely inherent boundary when the
    reason is stated in a comment.
- The evidence does not appear at the cited location.
- It restates a framework convention as a defect (every TanStack route file exports `Route`; that
  is the API, not duplication).

**Default to refuted when genuinely uncertain.** A false finding costs the reader more than a
missed one, because a report full of noise stops being read at all.

Set `correctedSeverity` only when the finding is real but graded wrong. The rubric: Major is a
bug, regression, security risk, IDOR, API contract violation, a rule duplicated across 2+ files,
or an unhandled edge case on a write or auth path. Minor is local simplification, convention,
hygiene, or a test gap outside a critical path.
