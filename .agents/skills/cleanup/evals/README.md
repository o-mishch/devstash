# Cleanup Skill Evaluations

Three scenarios that pin the behaviors this skill was rebuilt to guarantee. They exist so a change to the skill can be shown to improve or regress it, rather than judged by reading the diff.

Each `*.json` follows the shape in Anthropic's skill-authoring guide: `skills`, `query`, `expected_behavior`. There is **no built-in runner** — this is a rubric, checked by hand or by an agent given the file. That is the documented state of skill evals, not a gap here.

| File | Pins |
| --- | --- |
| `improve-coverage.json` | Coverage is enumerated by script, not sampled — the original bug |
| `public-history-secret.json` | A secret removed from HEAD but live in history is still Critical, and remediation waits for approval |
| `check-housekeeping.json` | All four housekeeping checks are reported, including the passing ones |

## How to run one

Start a fresh session on a changeset that fits the scenario, issue the `query`, and score each `expected_behavior` line as met or missed. A missed line is a skill defect, not a model defect — fix the skill.

The scenarios are deliberately about **process invariants** (was every file enumerated, was the gap disclosed, was approval sought) rather than specific findings. A findings-based eval would need a frozen changeset, and this repo's changeset moves constantly.

## Anti-regression note

`improve-coverage.json` exists because `/cleanup improve` once reported a different set of issues on every run over identical code, and reported none of the files it had skipped. If a future change makes the skill "read the files carefully" instead of enumerating them in `plan-improve.ts`, that eval is what should fail.
