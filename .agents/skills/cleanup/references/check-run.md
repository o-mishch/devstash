# Check and Run Playbook

Covers both `check` (read-only) and `run` (check, then fix what the user approves). `run` performs `check` first, which is why they share a file.

## Check Mode

Run this read-only scan and report numbered findings with severity, file refs, and remediation hints:

1. Run every check in `housekeeping.md` and report all four results — `improve` runs the same four, from the same file.
2. Search for accidental logs: `rg 'console\.(log|warn|error|debug)' src/`.
3. Search for stale comments: `rg '(TODO|FIXME|HACK)' src/`.
4. Search for TypeScript pragmas: `rg '@ts-(ignore|expect-error)' src/`.
5. Run `npm run lint`.
6. Check changed `src/actions/*.ts`, `src/app/api/**/route.ts`, and `src/lib/**/*.ts` for meaningful `*.test.ts` coverage, per `.agents/rules/testing.md § What to test`. Other stacks have their own testing rules and their own answers — `web/` ships no tests by decision; `backend/` is coverage-gated in CI. Do not apply this step outside `src/`.

Steps 2–6 look at `src/` only, deliberately — they encode the legacy stack's conventions and gates, which do not govern `web/` or `backend/`. A changeset that is entirely `web/` or `backend/` gets housekeeping and little else from this mode; say so rather than implying those files were scanned, and point the user at `improve`.

Stop after the report. Do not edit in `check` mode.

## Run Mode

Run `check` mode first. Then ask:

```
Which checks should I fix? Reply with numbers, all, or none.
```

Apply only the approved fixes. Verify with the narrowest relevant checks:

- Docs-only cleanup: no app lint/tests required.
- Source cleanup: `npm run lint` plus focused tests when action/lib behavior changed.
- Prisma cleanup: `npx prisma migrate status` plus relevant tests.

Return a compact summary table with columns: check, status, notes.
