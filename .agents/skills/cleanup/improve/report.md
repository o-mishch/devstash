# Improve — Report Template

> **Rendered by the Stage-A research subagent** and returned as its final message — that markdown *is* the subagent's only output. The main agent relays it verbatim, then **STOPs** to drive approval → fix → verify. The subagent never edits code or asks for approval; it only researches and reports.

User-facing report. **STOP** after report unless user requests fixes.

**Principles:** Lead with what matters. Plain language. Major issues first. Skip empty sections. No wall of tables. File list = area summary only (not every path). **KISS = decrease LOC** — always surface −LOC opportunities; flag +LOC creep.

```markdown
# Code quality audit

[date] · [N] uncommitted files reviewed

---

## At a glance

| | |
| --- | --- |
| **Overall** | 🟢 Clean / 🟡 Needs attention / 🔴 Critical issues |
| **Major** | N · **Minor** | N |
| **LOC (`src/`)** | +A −B (net Δ) · ↓ good / → watch / ↑ creep |
| **KISS (−LOC)** | N opportunities · est. **−XXX** lines recoverable |

_One sentence: biggest takeaway — tie to KISS/LOC (e.g. "+340 LOC creep; est. −120 recoverable via merges below")._

---

## What you're shipping

[2–3 sentences — what this changeset does as one solution, main user flows. No jargon.]

---

## KISS — decrease LOC

_Primary improve lever. List every −LOC opportunity: repeated patterns (incl. those whose other call sites are outside the changeset), existing-util/library-idiom applications, P2 merges, SSR conversions, redesigns. Omit section only if zero._

| ID | Cut / merge / simplify | est. LOC |
| --- | --- | --- |
| P2-5 | Merge `a.ts` + `b.ts` (same helper) | **−45** |
| P2-7 | Pattern repeated in 4 files → extract `useX` / apply existing util | **−60** |
| P5-1 | `foo.tsx` → server component | **−12** |
| | **Total recoverable** | **−117** |

_If net LOC is already ↓, note what drove the decrease. If ↑ creep, lead with biggest −LOC wins. For a library-idiom swap, cite the context7-confirmed API._

---

## Findings

_The complete catalogue — every finding stated **once**, referenced by ID. Group by P1→P5; omit priorities with zero findings. Within each priority, **Major (🔴) before Minor (🟡)**. The user picks fixes by ID from here. Card shape:_

### P4 — Bugs & logging

**🔴 [P4-1] Major — Error on critical path swallowed without `log.error`**
- **Problem:** … _(plain language)_
- **Evidence:** `route.ts:42` — _quote the offending line / shape_
- **Why it matters:** …
- **Fix:** one concrete action · **est. LOC:** −N / ≈0 / +N _(prefer −; if +, name what to delete/merge)_
- **Leaner option:** … _(only if the primary fix adds lines)_
- **Rule:** _coding-standards § Logging_ _(cite the exact `.agents/rules/*` file + section for any rule-compliance finding, any lens; omit only for pure KISS/DRY suggestions that break no rule)_

_If none across all priorities:_ `No issues found.` _(state what you checked — see checklist.md criticality note)_

---

## Detail tables

_Include a table **only** when it helps scan many related items. Skip empty tables entirely._

**Security & access** _(if P3 Major)_

| ID | Risk | What could go wrong | Fix |
| --- | --- | --- | --- |

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

- **At a glance → Overall:** 🔴 if any Major; 🟡 if Minor only; 🟢 if zero findings.
- **KISS / LOC:** `git diff --shortstat HEAD -- src/`. Always fill **KISS — decrease LOC** with every −LOC opportunity + total. Net **+** → **↑ creep** + P2 finding. Every recommendation needs est. LOC; default delete/merge/inline.
- **Findings** is the single catalogue: every finding once, grouped P1→P5, Major (🔴) before Minor (🟡). A −LOC finding also gets a row in **KISS — decrease LOC**; a per-area tally lands in **Summary**. Don't restate the finding's problem/fix anywhere but its **Findings** card.
- **Summary** counts must reconcile with **At a glance** totals and the **Findings** cards — same numbers, three views (totals · per-area · full).
