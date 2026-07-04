# Public Exposure Report Template

Use this template for `cleanup public`. Omit empty sections. Keep the report user-facing and concise.

```markdown
# Public exposure audit

[date] - repo scan: working tree + [N] commits ([full history | working tree only])
Tools run: secretlint [version] [+ gitleaks version, if run] [+ scripts/scan-git-history.sh, if gitleaks unavailable]

## At a glance

| | |
| --- | --- |
| Overall | Clean / Needs attention / Leak confirmed |
| Critical (real credentials) | N |
| Major (weak-signal secrets / broad PII) | N |
| Minor (borderline PII) | N |
| Still live in HEAD | N |
| Only in history (already removed from HEAD) | N |

[One sentence with the biggest takeaway — e.g. "No live credentials found in HEAD; one Stripe test-mode key sits in commit abc1234 from 2025-11."]

## Findings

**[S-1] Critical - [title]** _(confidence: high)_
- What: [what was found, generically described — do not repeat the raw secret value in the report]
- Where: `[file:line]`, commit `[sha]` ([in HEAD | history only])
- Category: Tier 1 credential / Tier 2 weak-signal / Tier 3 PII
- Why it matters: [what an attacker could do with it]
- Remediation:
  1. Rotate the credential at the provider (specific: e.g. "regenerate in Stripe dashboard → API keys")
  2. [If in HEAD] Remove from the working tree, add the real path to `.gitignore` if it's a file that shouldn't be tracked
  3. [If in history] Purge from git history — `git filter-repo --path [path] --invert-paths` (or BFG) — this rewrites history and requires a force-push; every clone must be re-cloned
- Unverified: [only for medium/low confidence — what would confirm it]

[repeat per finding, Critical → Major → Minor]

If there are no findings, write: `No secrets or PII found.` Then state exactly what was scanned (tools, commit range, working tree).

## History rewrite impact (only if any finding requires it)

Rewriting git history is destructive to every existing clone and fork. Before proposing it, state plainly:

- Every collaborator must re-clone or hard-reset to the rewritten history; old clones will diverge and re-push stale copies of the secret if not handled.
- Force-pushing a public repo's default branch touches anyone who forked or starred it — GitHub does not silently propagate the rewrite.
- If the credential can be rotated, rotating it makes the exposed value harmless — history rewrite becomes cleanup, not urgent containment. Recommend rotation first, history rewrite second (and only if the user wants the value gone from history entirely, e.g. compliance reasons).

## Scope reviewed

| Area | What |
| --- | --- |
| Working tree | secretlint over tracked + untracked files |
| Git history | [gitleaks --log-opts="--all", N commits | scripts/scan-git-history.sh walk, N commits | not run — state why] |

## Summary

| Category | Critical | Major | Minor |
| --- | --- | --- | --- |
| Tier 1 - Credentials | 0 | — | — |
| Tier 2 - Weak-signal secrets | — | 0 | 0 |
| Tier 3 - PII | — | 0 | 0 |
| Total | 0 | 0 | 0 |

Which finding IDs should I help you remediate? Reply with IDs such as `S-1`, `all critical`, `all`, or `none`. I will only prepare remediation steps for you to run — rotation, history rewrite, and force-push always need your explicit go-ahead and are not something I execute unattended.
```

Report rules:

- Never print the raw secret value in the report, even redacted-looking. Describe it (`Stripe live secret key`, `AWS access key + secret pair`) and point to file:line/commit instead. Secretlint and gitleaks both support redaction — use it.
- Sort findings Critical → Major → Minor.
- Every finding needs a remediation with concrete steps, not just "rotate the key."
- "Still live in HEAD" vs "history only" must be called out per finding — it changes urgency and the shape of the fix.
- Never take a remediation action (rotate, rewrite history, edit `.gitignore`, delete a file) without the user picking the finding ID first.
- `No secrets or PII found` is a strong claim — state the exact tool versions and commit range covered before writing it.
