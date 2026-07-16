# Check and Run Playbook

Covers both `check` (read-only) and `run` (check, then fix what the user approves). `run` performs `check` first, which is why they share a file.

## Check Mode

Run this read-only scan and report numbered findings with severity, file refs, and remediation hints:

1. Verify `context/history.md` is chronological from oldest to newest.
2. Verify `context/current-feature.md` goals and notes match the changeset. Do not edit `## Status`.
3. Search for accidental logs: `rg 'console\.(log|warn|error|debug)' src/`.
4. Search for stale comments: `rg '(TODO|FIXME|HACK)' src/`.
5. Search for TypeScript pragmas: `rg '@ts-(ignore|expect-error)' src/`.
6. If `prisma/schema.prisma` changed, run `npx prisma migrate status` and confirm a migration exists.
7. If env files or env types changed, compare `.env.example`, `.env`, `.env.local`, `.env._production`, and `src/types/env.d.ts`.
8. Run `npm run lint`.
9. Check changed `src/actions/*.ts`, `src/app/api/**/route.ts`, and `src/lib/**/*.ts` for meaningful `*.test.ts` coverage, per `.agents/rules/testing.md § What to test`. Other stacks have their own testing rules and their own answers — `web/` ships no tests by decision; `backend/` is coverage-gated in CI. Do not apply this step outside `src/`.

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
