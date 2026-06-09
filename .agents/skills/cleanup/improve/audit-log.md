# Improve — Audit Log & Fix Discipline

File: `context/cleanup-audit.md` — **prior-run notebook**, not source of truth.

**Purpose:** Tell the next `improve` agent what was decided, fixed, or deferred before — so it can compare **delta vs last run**, reuse stable IDs, and spot regressions.

**Two truths:**
1. **Code wins** — never assume an audit row is correct without checking scoped code.
2. **Audit rows are challenged every run** — nothing in the notebook passes as ignored (see **Mandatory reconcile** below).

## Scope rules

| Rule | Action |
| --- | --- |
| Scope | Only uncommitted files: `git diff HEAD` + untracked. No cap; no extras. |
| Empty scope | Ask user what to audit; stop. |
| Holistic | One solution — trace cross-file flows. |
| Coverage | Read every scoped file; list all in report **Scope reviewed**. |
| No solution edits | No source/config fixes until user approves IDs. Pre-approval write: `context/cleanup-audit.md` only (AUDIT-OUT). |
| Redesign | Encouraged when it **removes** structure; explicit approval before implementing. |

Convention details (API, logging, KISS): `improve/checklist.md` + `.agents/rules/*`.

## Mandatory reconcile

Every non-empty audit table is a **required challenge list**. Presence in the notebook does **not** mean pass, ignore, or skip.

Before REPORT, reconcile **every row** in each non-empty table:

### `Still open`

| Code check | Report | AUDIT-OUT |
| --- | --- | --- |
| Issue still present | **Audit reconcile → Still open** + **Needs your decision** + **All findings** | Keep in `Still open` |
| Fixed since last run | **Audit reconcile → Still open** → `Fixed` | Move to `Implemented` |
| Obsolete | → `Obsolete` + why | Remove; note in History |

### `Implemented` (prior fixes)

| Code check | Report | AUDIT-OUT |
| --- | --- | --- |
| Fix still holds | **Audit reconcile → Implemented** → `✅ Holds` | Keep in `Implemented` |
| Fix regressed | **Regressions** → `⚠️ Regression` | Move to `Still open` or fix in FIX step |

**Never** assume implemented = done without running each row's **Verify** hint in code.

### `Accepted tradeoffs`

| Code check | Report | AUDIT-OUT |
| --- | --- | --- |
| Tradeoff still valid | **Audit reconcile → Accepted** → `✅ Holds` | Keep in `Accepted` |
| Tradeoff violated | **Regressions** → `⚠️ Violated` + new finding | Remove from `Accepted`; add to `Still open` |

**Never** treat accepted = permanently off-limits — user decision stands only while code still matches.

### `Regression watchlist`

| Code check | Report | AUDIT-OUT |
| --- | --- | --- |
| Quick check passes | **Audit reconcile → Watchlist** → `✅ Pass` | Keep on watchlist |
| Quick check fails | **Regressions** → `⚠️ Regression` | Update `Implemented` / `Still open` as needed |

**Hard rules (all tables):**
- **Never** skip an ID because it appeared in a prior run or report.
- **Never** treat notebook rows as "already handled" without a code check this run.
- **Never** drop a row in AUDIT-OUT without explicit outcome + evidence.
- Report **Audit reconcile** must name **100%** of IDs in every non-empty table (first run with empty tables: omit section).

## AUDIT-IN

1. Open `context/cleanup-audit.md`; read **`## Next-run context`**.
2. Copy **every ID** from `Still open`, `Implemented`, `Accepted`, `Regression watchlist` into a working list (skip empty tables).
3. Full **P1→P5** on all uncommitted files **plus** mandatory reconcile of every copied ID.
4. Reconcile each table per **Mandatory reconcile** — before REPORT, not after.

## File layout

```markdown
# Cleanup Improve Audit

> Prior-run notebook for `/cleanup improve`. **Every table row challenged each run** — never passed as ignored. **History** = append only.

**Last run:** #N · DATE · M files · LOC src +A −B

## Next-run context

_One paragraph: what this changeset is and what improve runs have already done._

### Implemented (prior fixes — challenge in code each run)
| ID | What was done | Why | Key files | Verify |
| --- | --- | --- | --- | --- |

_Claimed fixes. Run **Verify** in code every run; report ✅ Holds or ⚠️ Regression._

### Accepted tradeoffs (user decided — challenge still applies)
| ID | What we chose | Why not the alternative |
| --- | --- | --- |

_Conscious deferrals. Re-check in code every run; report ✅ Holds or ⚠️ Violated._

### Still open
| ID | Pri | Issue | Lean recommendation |
| --- | --- | --- | --- |

_Required queue. Code-check every run; report Still open / Fixed / Obsolete._

### Regression watchlist
| ID | Risk if re-broken | Quick check |
| --- | --- | --- |

_Run **Quick check** in code every run; report ✅ Pass or ⚠️ Regression. Prior pass does not carry forward._

---

## History

### Run #N · DATE
**Stats:** … · **Fixes applied:** … · **New findings:** …
**Delta:** verified OK | regressions | new
_Optional: compact findings table for this run only_
```

## AUDIT-OUT

After report or fixes, **rewrite `## Next-run context`** (full refresh from all runs). Then **append** slim `### Run #N` under History.

| Section | When updated |
| --- | --- |
| Implemented | Item → Fixed: record **what** + **why** + verify hint |
| Accepted | User accepts tradeoff: record **why not** alternative |
| Still open | New findings or unchanged Open items; include est. −LOC for KISS items |
| Regression watchlist | All Implemented + Accepted rows |
| History | Append one block per run; keep compact |

**IDs:** `P{n}-{seq}` — reuse for same issue across runs.

| Outcome | Next-run effect |
| --- | --- |
| Fixed | → Implemented table; drop from Still open |
| Accepted | → Accepted tradeoffs; drop from Still open |
| Deferred / Skipped | → Still open (must stay in next report until fixed or accepted) |
| Open | → Still open (must appear in next report until resolved) |
| Obsolete | → remove from Still open; document why in History |

## DELTA checks

Compare this run to audit notebook **after** fresh code evaluation:

- Any audit ID missing from report **Audit reconcile** → **invalid run**
- Implemented + holds → **Audit reconcile → Implemented** → `✅ Holds`
- Implemented + regressed → **Regressions**; cite ID + original fix
- Accepted + holds → **Audit reconcile → Accepted** → `✅ Holds` (no duplicate finding)
- Accepted + violated → **Regressions** → `⚠️ Violated`; add to `Still open`
- Still open + fixed → **Audit reconcile → Still open** → `Fixed`; move to `Implemented`
- Still open + still broken → **Audit reconcile** + **Needs your decision** + **All findings**
- Watchlist + pass → **Audit reconcile → Watchlist** → `✅ Pass`
- Watchlist + fail → **Regressions** → `⚠️ Regression`
- New issue not in audit → new ID
- LOC grew without benefit → **P2 complexity creep** (prefer −LOC fixes in Still open recommendations)

## Fix discipline

**KISS = decrease LOC.** Improve ≠ add code. Prefer **net-negative** `src/`; neutral only when no leaner fix exists.

| Prefer (−LOC) | Acceptable (≈0) | Avoid (+LOC) |
| --- | --- | --- |
| Delete dead/duplicate code | Minimal one-line guard where delete isn't safe | New helpers wrapping existing logic |
| Merge into existing module | Extend existing function in place | New file for single-use export |
| Inline at call site | One focused test replacing brittle coverage | Wrapper layers (logger, error, cache) |
| Collapse abstractions | — | Re-implementing a prior fix differently |

Before editing: pick the fix path with **lowest LOC**. If the only fix adds lines, note est. Δ in report and delete/merge elsewhere in the same approved scope when possible.

After fixes: `git diff --shortstat HEAD -- src/`. Update **Implemented** with concrete what/why + LOC outcome. Net **> +10** without approved redesign → P2 finding; **> +20** → must explain in audit History.
