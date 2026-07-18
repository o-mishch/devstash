# Cleanup skill — design notes

**No agent reads this file.** It is the rationale behind the skill's structure, kept out of
`SKILL.md`, `references/`, and the scripts so that ~100 fan-out agents do not pay for it on
every run. Read it before changing the structure; do not copy it back into a file an agent
reads.

## The two failures this skill is built around

**1. Enumeration handed to something that samples.** The original `improve` gave one subagent,
in one turn, the whole job: read every changed file, widen to callers and callees, trace every
function, apply five lenses, audit against every rule. On a real changeset that is hundreds of
review units competing for one attention budget. It got through some of them, and *which ones
varied per run* — so re-running surfaced issues the first pass never looked at, and no report
ever said what it had skipped. A partial audit reported as clean is the bug.

So enumeration happens in code (`plan-improve.ts`) and reviewing fans out. Coverage stops
depending on a reviewer's diligence and becomes a property of the plan: every unit is spawned,
or it is visibly absent. **Do not collapse this back into "just read the files carefully."**

**2. Re-buying the same *divergent* context N times.** A fan-out agent does share one cached
prefix with its siblings — the workflow-subagent system prompt and tool definitions — so that
fixed block is amortized, not paid at full price per agent. Measured on this harness: five agents
fanned out *in parallel* each `cache_read` an ~9k shared prefix on their very first call, and
within a single agent every later turn reads its earlier turns back from cache at ~10% price.

What is **not** shared is everything past that prefix: each agent's own group-specific prompt, and
every file it reads as a tool result, land in the divergent region and are cache-*created* fresh in
that agent's context — each finder's context has already diverged before it reads, so a doc read by
all ~100 finders (`common.md`, a lens fragment) is paid ~100 times, once per agent. That per-agent
divergent payload is the cost the agent count multiplies, and shrinking it is what the rest of this
design does.

(An earlier version of this note claimed a subagent "starts cold and pays full price for everything
it reads." That overstated the penalty — the system+tools prefix is cached across siblings and
intra-agent re-reads are cached; only the divergent per-agent content is multiplied. The
conclusion — minimize each agent's divergent payload — is unchanged. The `improve` report now
surfaces the per-run token/latency telemetry these claims can be re-checked against; see
`references/improve-report.md`'s Coverage → *Run cost* rows.)

These two pull against each other, and the skill's shape is where they balance. Fan-out buys
coverage; everything else in the design exists to make each fanned-out agent cheap.

## Why the payload is shaped the way it is

An earlier version had every finder read `.cleanup-plan.json` (19 KB — *all* groups) to find
its one group, the whole checklist (13.5 KB — all five lenses, since split into
`references/improve/common.md` + `p1.md`–`p5.md`) to apply one, and every changeset-wide rule
file (19.5 KB) including rules its group could not violate. That is ~52 KB of fixed payload
before a single reviewed line, times 155 agents.

The fixes, and the constraint each one had to respect:

- **Per-group files** (`.cleanup-groups/gNN.json`, ~200 bytes). The obvious fix — have the
  workflow slice the plan — is impossible: the Workflow sandbox has no filesystem, so the
  script cannot read `plan.json`. The other obvious fix — have the main model pass group file
  lists inline in `args` — reintroduces exactly the silent-coverage-gap this skill exists to
  kill, because a mis-transcribed filename becomes an unreviewed file. So `plan-improve.ts`
  writes one small file per group and the workflow derives the path from `groupId`
  arithmetically. No transcription, no gap, 200 bytes instead of 19 KB.
- **Per-lens fragments** (`references/improve/`). Progressive disclosure: a P3 finder reads
  `common.md` + `p3.md`, a verifier reads `verify.md` alone (1.5 KB, not 13.5 KB).
- **Per-group rule scoping.** `matchingRuleFiles` is computed against the group's own files,
  not the whole changeset, so a `web/` group never loads the Go standards.

## Why P4 and P5 share one agent but P3 does not

Three lenses per group meant the same ~500 LOC was read three times, each read dragging the
full fixed payload. P4 (bugs/logging) and P5 (convention/hygiene) are both close-reads of the
same source for defects, and merge cleanly into one pass — the merged finder tags each finding
with its own lens, so the report and the finding IDs are unchanged.

P3 stays alone deliberately. It is the security lens (IDOR, auth bypass, token handling), and
an isolated attention budget is worth more there than the agent it saves. The failure mode of
merging it is a missed auth bug, which the refutation pass cannot recover — a verifier only
removes findings, it never adds the ones a finder missed.

Note the interaction with model tiering: because finders run on Haiku, the ~500 LOC group
budget matters *more*, not less. The long-context research the group sizing follows is explicit
that accuracy degrades early and non-uniformly, and worst when distractors resemble the target
— which is precisely a group of sibling React components. Do not raise `GROUP_LOC_BUDGET` to
cut agent count; that trades recall for a saving the payload fixes already delivered.

**The one exception: `MERGE_UNITS_LOC_BUDGET` (150 LOC).** At or below this size, a group runs a
single `P3P4P5` unit instead of the usual two. This is not a reversal of the P3-isolation
argument above — it targets a different regime. The isolated-attention-budget case for P3 assumes
a group near the ~500 LOC budget, where the fixed payload (doctrine + lens fragment + ruleFiles)
is small relative to the code being read. At 150 LOC or less, that relationship inverts: the fixed
payload — often 10k+ tokens once `ruleFiles` pulls in 2–3 rule files — dominates a group two agents
would mostly spend re-reading each other's context to review a handful of lines. The isolated
budget is worth less there because there is barely enough source for a shared budget to be
crowded by. Do not lower `MERGE_UNITS_LOC_BUDGET` to claw back more agents — it is already set
well below `GROUP_LOC_BUDGET` so it only fires on the clearest cases; raising it trades away real
P3 isolation for a saving that shrinks per group as the threshold rises.

## Why finders are Haiku, verifiers and P1/P2 are Sonnet, and the report inherits

A finder does bounded pattern-matching: one lens, ~500 LOC, an explicit checklist. That is
within the cheap tier, and it is where the agent volume is (~100 of ~104 finders).

**P4/P5 finders also run at low reasoning effort**, not just the cheap model. The recall
scaffolding is externalised into the checklist — `common.md`'s edge-case enumeration plus the lens
fragment's signal list — so a P4/P5 finder is closer to "execute this checklist against these
files" than to open-ended reasoning, and low effort is where that kind of task belongs. It is safe
*there specifically* because the failure a thin budget causes is a false positive, and precision is
Verify's job (a Sonnet refuter attacks every uncertain finding) — the "report generously" doctrine
even pushes finders to over-report on purpose.

That argument does **not** extend to P3, and the effort dial is gated on the unit's lenses to
respect the boundary: any unit containing P3 — the standalone `P3` and the merged `P3P4P5` — keeps
its default effort. P3 is the security lens, where the failure mode is a *false negative* (a missed
IDOR or auth bypass), and Verify only ever removes findings, so a bug a thin finder misses is
unrecoverable. This is the identical reason P3 resists the P4/P5 merge two sections up; the effort
tier honours the same line. The cut therefore lands only on the pure `P4P5` units — the highest
volume and lowest per-finding stakes — while every security pass, and every `src/` group (always
merged to `P3P4P5`), runs at full depth. Verifiers, P1/P2, and the report likewise keep default
effort: each is a judgement call whose cost of being wrong is unrecoverable.

Verifiers were the run's actual cost. They inherited the session model — Opus — and at ~5x
Haiku's input price against a pool the "report generously" doctrine deliberately inflates, the
Verify phase dominated every other stage combined. They now run on Sonnet. Refutation is still a
judgement call, and a wrong refutation still silently deletes a real finding, so this does not
drop to the finder tier: the job is bounded (read this file, check this claim against this rule)
but the cost of getting it wrong is unrecoverable, because a verifier only removes findings and
never adds back the one it killed. Sonnet is where those two facts meet.

P1/P2 moved to Sonnet for the same reason as Verify, not the opposite one. They judge an import
graph and clone candidates against a bounded checklist — the same shape of task as Verify, just
at 2 agents instead of ~50. Two agents on the session model is not "noise" the moment the session
model is Opus and the structure payload is large (a changeset with a big import graph or many
clone candidates pays the same ~5x multiplier Verify did, just twice instead of fifty times) — it
is a smaller instance of the identical failure mode, so it gets the identical fix. Only the final
report keeps the session model: it is one agent synthesising the whole run, and there is no
volume to multiply.

## Why a small changeset auto-downgrades to a quick tier

`MERGE_UNITS_LOC_BUDGET` collapses two units into one *within* a group when that group's code is
small relative to its fixed payload. `QUICK_TIER_GROUP_THRESHOLD` is the same argument one level
up: when the whole changeset is only a handful of groups, the run's fixed costs — Sonnet-tier
Verify agents, each re-reading a file already read once by its finder — dominate a changeset that
barely has enough findings to verify. Below the threshold, every group is forced to its merged
unit and the Verify pass is skipped outright; medium/low findings render as `quick-tier` instead
of `survived`/`unverified`, so the report can never imply a refutation pass ran that didn't.

This is a cost floor, not a coverage cut: every group is still enumerated by `plan-improve.ts` and
fanned out, exactly as `improve` was rebuilt to guarantee — see "The two failures this skill is
built around," above. What changes is precision, not recall: an unrefuted medium-confidence
finding costs the reader one extra judgment call; a silently unreviewed file is the bug this
skill exists to prevent. Those are not the same risk, which is why one is an acceptable tradeoff
at small scale and the other never is.

The threshold triggers automatically rather than through a separate mode name so that `improve`'s
promise — every group enumerated, every group fanned out — never depends on the user picking the
right command for the size of their diff. `plan-improve.ts` prints the quick-tier line before any
agent is spawned, and `SKILL.md` requires it be said to the user up front, for the same reason the
agent count itself is announced: a cost or coverage shape that changed silently is exactly the
kind of thing this skill's design elsewhere refuses to let happen quietly.

## Why src/ groups merge, and web/ + backend/ do not

`MERGE_UNITS_LOC_BUDGET` and `QUICK_TIER_GROUP_THRESHOLD` decide the unit count by *size*.
`MERGED_UNIT_STACKS` (`plan-improve.ts`) adds one decision by *stack*: a group under `src/` runs
the single merged `P3P4P5` unit regardless of its LOC, while `web/` and `backend/` groups keep the
two-unit split. The reason is not that `src/` code is smaller — it is that `src/` is
maintenance-only (`boundary.md`): it gets bug fixes and security patches but no new features, so
the marginal value of a second finder deepening P5 convention/hygiene review there is low, while
the same spend on the two stacks under active development is where new defects actually land. This
is the deliberate emphasis shift toward the new stacks, expressed as cost rather than as a coverage
cut.

It is a *depth* reduction, not a floor breach. The merged unit still applies P3 (security/IDOR) and
P4 (bugs) in full, and — critically — Verify is untouched: it is gated on `quickTier`, not on unit
count, so a merged `src/` group's medium/low-confidence security and bug findings are still
refuted. A real regression in a live-app patch is caught and verified exactly as before; only the
second finder that would have deepened convention review is not spent. If `src/` ever leaves
maintenance-only, delete it from `MERGED_UNIT_STACKS` and the two-unit split returns.

The emphasis shift's other half is content, not cost: the `web/` and `backend/` bullets in the lens
fragments carry the modern-stack signals (TanStack Query invalidation and optimistic-update shape,
Router `loaderDeps`, `useEffect`-as-derived-state, Go goroutine exit paths, context propagation,
`%w` wrapping). Those are audit-lens signals, not rule restatements — `web-architecture.md` says
web idioms are not yet standing rules, and `go-coding-standards.md` states no concurrency rule — so
they are filed without a `rule` field, and the finder still quotes the actual rule file for
anything that *is* a rule. Cost tiering and content enrichment are the two independent levers; a
change to one is not a licence to touch the other.

## Why only `p4` splits into per-stack fragments

The `web/` and `backend/` enrichment above made the lens fragments carry stack-specific bullets.
A finder for a `src/` group then paid for the `web/` and `backend/` bullets it could never act on,
and vice versa — a fixed payload multiplied across ~100 cold-start agents, the exact cost this
design exists to squeeze. The fix is per-stack companion fragments (`p4.web.md`, `p4.backend.md`,
`p4.src.md`): `improve-audit.js` derives a group's stack from its `area` and loads the shared
`p4.md` plus only that stack's companion.

The split is `p4`-only on purpose, and the reason is *which fragments a finder actually loads*.
Finder units are `P3`, `P4P5`, or the merged `P3P4P5` — so finders load `p3`, `p4`, `p5`, never
`p1`/`p2`. **`p1` and `p2` are changeset-wide**: one agent each, spanning every stack, so it needs
all stacks' bullets regardless — splitting them saves nothing and just fragments a file. Among the
finder-loaded three, only `p4` carries enough stack-specific bulk to matter: `backend`'s
goroutine/context/`%w` cluster and slog rule, `web`'s four TanStack/optimistic/loader/`useEffect`
bullets and console rule, `src`'s Pino rule. `p3`'s stack content is two validation sub-bullets
(~30 tokens) and `p5`'s is citation guidance, not signals — neither earns three more files. If a
future edit gives `p3` or `p5` a comparable per-stack bulk, add it to `STACK_FRAGMENT_LENSES` in
the workflow and create the companion fragments; the loader already handles any lens in that set.

## Why context/ is excluded from the audit

`IGNORED_PREFIXES` (`lib/rules.ts`) drops `context/` from every changeset bucket, in one place that
both `resolve-context.ts` and `plan-improve.ts` flow through. `context/` is the project's own
bookkeeping — the migration log, history, and current-feature doc — not application code with a
governing rule, so a lens has nothing to say about it. It is filtered *downstream* of
`changedFiles()` on purpose: the "changeset matches git" pin test asserts `changedFiles()` is exact
against git, and that guarantee must not move. The housekeeping checks that *read* `context/`
(history order, feature alignment) are unaffected — they run unconditionally in step 4 and were
never driven by the changeset classification, so excluding `context/` from the audit does not
weaken the bookkeeping that watches it.

## Why only medium/low-confidence findings are verified, one agent per file

The recall/precision split still holds: finders report generously, refuters kill what does not
survive. But a high-confidence finding must already quote evidence from the file to be filed at
all, so refuting it mostly re-derives what the finder proved. Verifying only what the finder
itself flagged as uncertain roughly halves the verifier pool and concentrates it where
precision is actually at risk.

One refuter per finding, not three: the finder pool is already large, and three refuters on a
busy changeset would approach the 1000-agent backstop — where the loss is silent truncation,
which is the thing this design removes.

**The Verify stack-tier: `web/` and `backend/` medium findings skip refutation, `src/` never does.**
`VERIFY_SKIP_STACKS` in `improve-audit.js` widens what goes unrefuted for the two actively-developed
stacks: a *medium*-confidence `web/`/`backend/` finding ships tagged `skipped-medium` instead of
spending a Sonnet refuter. The justification is that the enriched web/backend signals are mostly
structural — a `useMutation` with no `invalidateQueries`, a goroutine with no `case <-ctx.Done()` —
so the finder's quoted evidence is usually already conclusive, and a refuter mostly re-derives it.
This is the mirror image of the `src/`-merge decision, and it keeps the same floor: `src/` is the
live app, so its medium/low findings are *always* refuted; and even for the skipped stacks, only
`medium` is widened — `low` confidence is genuinely uncertain and stays in the refutation batch.
The cost this trades against is precision, exactly as the quick tier does: a `skipped-medium`
finding keeps its `Unverified` line and never renders as `survived`, so the reader sees plainly
that it was not attacked. Recall is untouched — Verify only ever *removes* findings, so skipping it
cannot lose one.

**Batched by file, not spawned per finding.** Every finding names the file its evidence lives in,
and a verifier's first act is to open that file. Per-finding spawning meant five findings in one
file were five agents each independently re-reading the same source and the same rule files — the
duplicated read *is* the finding count, which is the number the recall doctrine is designed to
push up. Batching moves the cost driver from findings to distinct files, so generous recall costs
a longer candidate list rather than another agent. That is also why the recall bar was left alone
rather than tightened: once the driver is file count, dropping low-confidence findings buys almost
nothing and gives up the high-severity/low-confidence finding this audit exists to surface.

The tradeoff is attention: one agent now judges several findings instead of one each. `verify.md`
carries the countermeasure — judge each candidate on its own evidence, a batch is a way to read
the file once and not a verdict about the file. The verdict schema is keyed by an explicit
`index` rather than array position, so a verdict the model omits lands as `unverified` instead of
silently mis-assigning itself to the next finding.

## Structural rules that look like duplication but are not

- **Every reference is listed one level from `SKILL.md`.** A reference reached only through
  another reference tends to get previewed with a partial read, which silently drops the tail
  of a rubric. `housekeeping.md` therefore appears in three mode rows — that is the rule
  working, not a duplicate. The `references/improve/` fragments are the deliberate exception:
  they are addressed by the workflow script with explicit paths, never reached by the main
  agent through a chain of references.
- **The path→rule mapping lives in rule frontmatter, never in a table here.** A second copy
  costs ~1.2k tokens per run and drifts from the source. It did drift: `legacy-ops.md`'s table
  row claimed `src/**/*` while the rule file globbed `package.json`/`.env*`/`prisma`.
- **Prompt wording lives in the checklist fragments, not in the workflow.** An early draft
  inlined per-lens summaries in `improve-audit.js`, which is the drift the checklist itself
  forbids ("quote the rule; do not paraphrase it from memory") and duplicated the sections it
  summarised. Agents can read; they read the doctrine at its source.

## Why `workflows/improve-audit.js` is `.js` and not `.ts`

Everything under `scripts/` is TypeScript because it runs on bare `node`, which strips types
natively. `improve-audit.js` does not run on node — it is submitted to the Workflow tool and
executed by its own interpreter, whose contract states: "Scripts are plain JavaScript, NOT
TypeScript — type annotations, interfaces, and generics fail to parse." That sandbox also has
no filesystem and no Node APIs, and `Date.now()`/`Math.random()` throw. A `.ts` workflow fails
at submit time. JSDoc is the available substitute: plain JS syntax, real editor types.

## Why `git status --porcelain` is not used

It **collapses a fully-untracked directory** into a single entry (`web/src/routes/`). Handing
that to a reviewer hands it a directory and lets it decide, ad hoc, which files inside to open
— a different subset every run, which was one of the two reasons a repeated audit kept finding
"new" issues. On this repo it under-reported 230 files as 31.

It also broke rule resolution: a bare `backend/internal/x/` does not match `backend/**/*.go`,
so a brand-new untracked Go package resolved with `go-coding-standards.md` silently never
loaded. `git diff --name-only HEAD` always lists files, and `git ls-files --others` enumerates
untracked files individually; `-z` keeps paths with spaces intact, which porcelain's quoting
mangled.

## Why `resolve-context.ts` always exits 0

`SKILL.md` injects it via `!`, so its stdout *is* the skill's Scope section. A throw past the
top-level catch writes nothing: `/cleanup` then renders with no changeset, no rule list, and no
usage table — it silently does nothing, the worst available failure for a tool whose whole job
is not missing things. Reachable, not theoretical: `git diff HEAD` fails in a repo with no
commits, and every git call fails outside a work tree. Both produced 0 bytes and exit 1 before
this existed.

Its frontmatter cross-checks exist for the same reason: `trigger:` is Antigravity's field,
inferred and unverified, while `paths:` is what Claude Code actually scopes on. Keying on
`paths:` and cross-checking `trigger:` means a typo'd `trigger:` still resolves correctly, and
the drift is reported rather than silently applied. The `generated:` warning catches a rule
that tells a reader "never hand-edit this" but never declared which paths it means — those
files then get audited as hand-written (7k lines of emitted CSS on this repo, until the key was
added).

## Why the frontmatter parser is hand-rolled

A skill must run on a fresh clone with only `node` present; an uninstalled dependency turns the
skill into a silent no-op. `frontmatterList` reads only the subset this repo authors — `key:`
followed by `  - "value"` lines, plus the inline `["a","b"]` form `go-coding-standards.md` uses.
Anything richer is out of contract; keep rule frontmatter in this shape.

Glob matching is `node:path`'s built-in `matchesGlob`, not a hand-rolled glob→regex engine. The
engine it replaced needed sentinel-character tricks to make `**/` match zero directories, and
its failure mode was a rule that silently never loaded.

## The ledger is a cache

`context/cleanup-findings.md` labels a finding `new`/`known`/`fixed` across runs. It never
suppresses work, never skips a unit, and never stands in for reading the code — every finding
is re-derived from source every run. A ledger entry is evidence about a previous run, not about
the code as it is now. The codebase is the only source of truth.
