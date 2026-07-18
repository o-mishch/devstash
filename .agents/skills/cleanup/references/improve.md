# Improve Playbook

Goal: audit **every** changed file against **every** lens in one run, then fix only approved
finding IDs.

Coverage is a property of the plan, not of a reviewer's diligence: `plan-improve.ts` enumerates
every unit, and each one is spawned or is visibly absent from the plan. Do not collapse this into
"just read the files carefully" — that is the failure mode, not a shortcut past it. Why the
fan-out is shaped this way: `../DESIGN.md`.

**Reviewer stance:** `improve/common.md` is the reviewing doctrine. The fan-out agents are given
it directly; read it yourself before step 7 so you can judge what comes back.

## Procedure

1. **Plan.** `node .agents/skills/cleanup/scripts/plan-improve.ts --out .cleanup-plan.json`

   It prints the group count, LOC, and agent count, and writes one file per group under
   `.cleanup-groups/`. Say the agent count to the user before step 5. It separates four buckets
   you must not conflate:

   **Quick tier.** At or below `plan-improve.ts`'s `QUICK_TIER_GROUP_THRESHOLD` groups, the plan
   sets `quickTier: true`: every group is forced to its merged unit (`P3P4P5`, one agent) and the
   fan-out skips the Verify refutation pass entirely. This is a cost floor for a small changeset,
   not a coverage cut — every group is still enumerated and fanned out, never sampled. Tell the
   user it triggered, before fanning out, and the report's Coverage section must say so too: a
   quick-tier finding renders `verification: quick-tier` rather than `survived`/`unverified`.
   - **groups** — lens-audited source, packed to ~500 LOC at file boundaries.
   - **generated** — rule-declared artifacts (`generated:` frontmatter). Step 3 only.
   - **notLensed** — assets, docs, config. Listed in the report's scope table; no lens applies.
   - **deleted** — unreadable, but a deletion breaks callers. Cover them in step 5.

   If there are no groups, say so and stop.

2. **Extract structure.** `node .agents/skills/cleanup/scripts/extract-structure.ts --plan .cleanup-plan.json --out .cleanup-structure.json`

   Clone candidates (jscpd), the import graph, and the exported-symbol inventory — what P1 and P2
   judge instead of reading 15k lines. Surface any `NOTE:` it prints: a note means a detector did
   not run, so that lens is **degraded, not clean**, and the report must say so.

3. **Hand-edit check (generated files).** For each `generated` path whose rule marks it
   reproducible offline, regenerate into a temp dir and diff against the working tree. Never
   regenerate in place — the worktree holds the user's uncommitted work. Where a rule marks a path
   not reproducible offline (network fetch, build-time only), report it `unverifiable`, not clean.

4. **Housekeeping.** Run every check in `housekeeping.md`. They render as the report's
   Housekeeping table, which is never omitted — an all-`OK` table is the proof it ran.

5. **Fan out.** Invoke the `Workflow` tool with
   `scriptPath: ".agents/skills/cleanup/workflows/improve-audit.js"` and `args`:

   ```json
   {
     "groupDir": ".cleanup-groups",
     "structurePath": ".cleanup-structure.json",
     "ledgerPath": "context/cleanup-findings.md",
     "groups": [ "...the plan's groups array, mapped to {id, units, area} triples, verbatim..." ],
     "changesetLenses": [ "...the plan's lenses whose scope is 'changeset', verbatim..." ],
     "ruleFiles": [ "...the plan's ruleFiles array, verbatim..." ]
   }
   ```

   Pass ids and paths, never file lists. Each agent reads its own group file out of `groupDir`,
   which carries both that group's files and the rules those files can actually break — so a
   filename you mis-transcribe cannot become a silent coverage gap. Each group's `area` rides
   along verbatim from the plan: the workflow derives the group's stack from it to load the
   matching per-stack lens fragment (`p4.web.md`, `p4.backend.md`, …), so copy it, don't compute
   the stack yourself.

   A group's own `units` (from the plan, one entry per group) says how many finder agents that
   group gets: the usual two (`P3`, `P4P5`), or a single merged `P3P4P5` — for a small group
   (`plan-improve.ts`'s `unitsFor()`) or a `src/` maintenance-only group (`applyStackTier()`).
   Pass each group's `units` verbatim from the plan; do not recompute the threshold yourself.

   Mention the `deleted` paths in the prompt only if non-empty — a deletion still breaks callers.

6. **Check coverage before reading findings.** The workflow returns `coverage`. Reconcile it
   against the plan:
   - every file in every group appears in `covered`, and
   - `skipped` is empty, or every entry carries a reason you accept.

   If files are missing, **say so in the report** and offer to re-run. A partial audit reported as
   clean is the bug this replaced.

   Also capture the Workflow completion's `usage` block — `subagent_tokens`, `duration_ms`, and the
   `agents_done` / `agents_error` / `agents_skipped` counts. Render them in the report's Coverage
   *Agents* and *Run cost* rows. `agents_error`/`agents_skipped` are a second, independent read on
   coverage: a finder that errored reviewed nobody, so its group is unreviewed even if the plan
   enumerated it — reconcile it against the `covered` list above rather than treating it as noise.

7. **Classify against the ledger.** Read `context/cleanup-findings.md` if it exists. Mark each
   finding `new`, `known` (an ID already there), or `fixed` (in the ledger, no longer found). The
   ledger is a cache, never a source of truth — the codebase is. Write it back with this run's
   findings.

8. **Render** using `improve-report.md`. Each finding carries a `verification` field:
   `survived` (a refuter attacked it and failed), `skipped-high-confidence` (the finder quoted
   evidence that settles it, so no refuter was spent), `skipped-medium` (a medium-confidence
   `web/` or `backend/` finding the Verify stack-tier intentionally left unrefuted — `src/` never
   gets this, it is always refuted), or `unverified` (its refuter died — mark it, never drop it).

9. **Ask which finding IDs to fix.** Accept IDs such as `P2-1`, `all major`, `all minor`, `all`,
   or `none`.

10. **Apply only approved fixes**, then verify with the gate for the stack you touched
    (`ai-interaction.md § Verification`). For `web/`, that is `web-architecture.md § Gates` —
    typecheck, lint, build — not tests; `web/` ships none by decision. For this skill's own
    scripts, run both gates in `typescript-standards.md § Skill scripts`: `node --test` **and** the
    `tsc --erasableSyntaxOnly` typecheck. `node` strips types without checking them, so the test
    run alone does not prove the types.
