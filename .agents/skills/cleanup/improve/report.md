# Improve — Report Template

User-facing report. **STOP** after report unless user requests fixes.

**Principles:** Lead with what matters. Plain language. Major issues first. Skip empty sections. No wall of tables. File list = area summary only (not every path). **KISS = decrease LOC** — always surface −LOC opportunities; flag +LOC creep.

```markdown
# Code quality audit

**Run #N** · [date] · [N] uncommitted files reviewed

---

## At a glance

| | |
| --- | --- |
| **Overall** | 🟢 Clean / 🟡 Needs attention / 🔴 Critical issues |
| **Major** | N · **Minor** | N |
| **LOC (`src/`)** | +A −B (net Δ) · ↓ good / → watch / ↑ creep |
| **KISS (−LOC)** | N opportunities · est. **−XXX** lines recoverable |
| **Audit reconcile** | N/N IDs challenged (open · implemented · accepted · watchlist) |
| **Since last run** | ⚠️ N regressions · 🆕 N new findings |

_One sentence: biggest takeaway — tie to KISS/LOC (e.g. "+340 LOC creep; est. −120 recoverable via merges below")._

---

## What you're shipping

[2–3 sentences — what this changeset does as one solution, main user flows. No jargon.]

---

## KISS — decrease LOC

_Primary improve lever. List every −LOC opportunity (P2, SSR, redesign). Omit section only if zero._

| ID | Cut / merge / simplify | est. LOC |
| --- | --- | --- |
| P2-5 | Merge `a.ts` + `b.ts` | **−45** |
| P5-1 | `foo.tsx` → server component | **−12** |
| | **Total recoverable** | **−57** |

_If net LOC is already ↓, note what drove the decrease. If ↑ creep, lead with biggest −LOC wins._

---

## Needs your decision

_List only Open findings. Major first, then Minor. If none: "Nothing blocking — optional minor items below."_

### 🔴 Fix now (Major)

**[P4-1] Short title**
Problem in plain language.
→ *Suggested fix:* one concrete action · **est. LOC:** −N / ≈0 / +N _(prefer −; if +, name what to delete/merge)_

### 🟡 Optional (Minor)

**[P5-6] Short title**
Problem.
→ *Suggested fix:* … · **est. LOC:** −N / ≈0 / +N

---

## Regressions

_Include when any Implemented / Accepted / Watchlist reconcile → ⚠️, or other regression. Otherwise omit._

⚠️ **[P3-1] Title** — Implemented run #2; [what broke again].  
→ Revert or re-apply: …

---

## Audit reconcile

_Mandatory when **any** audit table is non-empty. Challenge every ID in code — notebook presence ≠ pass. One row per ID per subsection; none omitted._

### Still open

| ID | Pri | Code check | Outcome |
| --- | --- | --- | --- |
| P3-1 | Major | `updateUserEmail` still in customer webhook | **Still open** → Needs your decision |
| P2-1 | Minor | hook inlined, file deleted | **Fixed** |

_Still open → also in **Needs your decision**. Outcomes: **Still open**, **Fixed**, **Obsolete** (+ why)._

### Implemented

| ID | Code check | Outcome |
| --- | --- | --- |
| P3-1 | `StripeWebhookRetryError` still re-thrown in route | ✅ Holds |
| P4-3 | layout revalidation removed | ⚠️ Regression → see Regressions |

### Accepted tradeoffs

| ID | Code check | Outcome |
| --- | --- | --- |
| P1-1 | billing module still ~70 files, no new coupling | ✅ Holds |
| P2-4 | net LOC +833, no merge attempted | ✅ Holds |

### Regression watchlist

| ID | Quick check | Outcome |
| --- | --- | --- |
| P3-2 | DB fail-open branch still at pro-access-resolution L82–93 | ✅ Pass |

_Omit empty subsections. First run with all tables empty: omit entire **Audit reconcile** section._

---

## All findings

_Group by P1→P5. Omit priorities with zero findings. Use this card shape:_

### P4 — Bugs & logging

**[P4-5] Minor — Webhook retry logged as unhandled**
- **Problem:** …
- **Why it matters:** …
- **Fix:** … _(prefer inline/merge; est. LOC Δ)_
- **Leaner option:** … _(if primary fix adds lines)_
- **Files:** `api.ts`, `route.ts`

_If none:_ `No issues found.`

---

## Detail tables

_Include a table **only** when it helps scan many related items. Skip empty tables entirely._

**Security & access** _(if P3 Major)_

| ID | Risk | What could go wrong | Fix |
| --- | --- | --- | --- |

**KISS detail** _(extra P2 rows if many — same data as **KISS — decrease LOC**, sorted −LOC first)_

| ID | Current | Simpler option | est. LOC |
| --- | --- | --- | --- |
| P2-1 | 3 files, same helper | merge into `foo.ts` | **−45** |

**Redesign** _(if P1 structural)_

| ID | Today | Proposed | Why worth it |
| --- | --- | --- | --- |

**SSR** _(if `src/app/` or `src/components/` in scope)_

| ID | File | Current | Can convert? | est. LOC | Verdict |
| --- | --- | --- | --- | --- | --- |
| P5-1 | `foo.tsx` | client, display-only | → server component | **−12** | Minor |

---

## Scope reviewed

| Area | Files |
| --- | --- |
| `src/lib/billing/` | 69 |
| `src/app/` | 24 |
| … | … |
| **Total** | **N** |

<details>
<summary>Full file list (N)</summary>

- path/to/file.ts
- …

</details>

_Omit `<details>` if N ≤ 30 — list inline._

---

## Summary

| Area | Major | Minor |
| --- | --- | --- |
| Architecture | 0 | 0 |
| KISS & −LOC | 0 | 0 _(N −LOC opps · est. −XXX)_ |
| Security & access | 0 | 0 |
| Bugs & logging | 0 | 0 |
| Convention & tests | 0 | 0 |
| **Total** | **0** | **0** |

---

**What should I fix?** Reply with IDs (e.g. `P3-5, P4-5`), `all minor`, `all major`, redesign names, or `none`.  
Major redesigns need explicit approval before I edit code.
```

## Agent notes (not in user report)

- **Audit reconcile = mandatory.** Every non-empty audit table: challenge 100% of IDs in code. Notebook row ≠ pass.
- **Still open** still broken → **Needs your decision** + **All findings**. Never skip because reported last run.
- **Implemented** → ✅ Holds or ⚠️ Regression. Never assume fixed without **Verify** hint.
- **Accepted** → ✅ Holds or ⚠️ Violated. Never treat as permanently off-limits.
- **Watchlist** → ✅ Pass or ⚠️ Regression. Prior pass does not carry forward.
- Missing any audit ID from **Audit reconcile** → invalid run.
- **At a glance → Overall:** 🔴 if any Major; 🟡 if Minor only; 🟢 if zero findings.
- **KISS / LOC:** `git diff --shortstat HEAD -- src/`. Always fill **KISS — decrease LOC** with every −LOC opportunity + total. Net **+** → **↑ creep** + P2 finding. Every recommendation needs est. LOC; default delete/merge/inline.
- Keep **Needs your decision** ≤ 10 items visible; rest stay in **All findings** only if many.
