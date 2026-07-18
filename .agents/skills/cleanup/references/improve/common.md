# Reviewing doctrine (all lenses)

Read this plus your own lens fragment (`p1.md`…`p5.md`). Nothing else here applies to you.

## How to read code here

Be adversarial. Assume each change is hiding a bug, a leak, or a duplicated rule until you have
traced it and proven otherwise. Read past the diff into the surrounding function — an edit is
wrong as often because of an invariant it silently breaks nearby as because of the line itself.
Do not pass a function on a glance; either raise a finding or be able to say the specific reason
it is safe.

For every changed function, walk these and treat an unhandled one as a finding unless you can
name why it cannot occur:

- Inputs at the extremes: null/nil, undefined or the zero value, empty string, empty
  array/object/slice/map, `0`, negative, very large, duplicate, and untrusted/attacker-shaped
  values.
- The unhappy path: the throw, the rejected promise, the 4xx/5xx branch, the early return — does
  it leave state half-written, a lock held, a loader spinning, or an error swallowed?
- Concurrency and ordering: two callers at once, a retried webhook, an out-of-order event, a
  check-then-write gap (TOCTOU).
- Async correctness — walk the async signals in `p4.md` — plus a missing transaction or
  multi-statement write that should be one statement.
- Data the user supplies but you did not validate, and data you return that you should not.

## Rule compliance

Audit against every rule file listed in your prompt. Any deviation from a rule is a finding.

- Major: rules phrased as must/never, security, architecture, database, or API contract
  violations.
- Minor: soft convention or hygiene issues.
- Cite the rule file and section in each rule-compliance finding.
- Honor `context/current-feature.md` when it explicitly supersedes a standing rule for files in
  scope.
- The rule files are the only source of truth for what a rule says. A bullet in a lens fragment
  may name the mechanism a stack uses — where to look — but never what its rule requires or
  forbids. **Quote the rule; do not paraphrase it from memory.**

## Severity and confidence

Major examples: bug, regression, security risk, trust-boundary leak (in `src/`, a server-only
module reachable from the client bundle), IDOR, API contract violation, a rule duplicated across
2+ files (a guard, limit, price, permission, or error map), missing critical-path tests where
that stack's testing rule requires them, swallowed critical error, unhandled edge case on a
write or auth path.

Minor examples: local simplification, non-critical convention issue, hygiene cleanup, an
unnecessary client component (`src/`), or a test gap outside a critical path.

Confidence is separate from severity, and it drives verification: a separate pass attacks every
medium- and low-confidence finding, so mark `high` only when you have quoted evidence from the
file that settles it — reasoning from a pattern rather than the line in front of you is `medium`.
A `high` finding skips refutation entirely, so recall and precision split cleanly across the two
passes: **report generously** here (a low-confidence finding with an `unverified` line costs far
less than a real defect you talked yourself out of), and let the refuter kill what's wrong. This
does not license guessing — every finding still needs real evidence quoted from the file. Do not
let low confidence talk you out of a serious-but-uncertain finding, and do not inflate confidence
to look decisive.

## Prove your coverage

Report every file you actually read. Any file in your group you did not review must be named
with a reason. A silently unreviewed file is the exact failure this audit was rebuilt to
prevent — an unreported gap is indistinguishable from a clean result.
