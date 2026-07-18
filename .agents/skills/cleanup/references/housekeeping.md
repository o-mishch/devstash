# Housekeeping Checklist

The four repo-bookkeeping checks shared by `check`, `run`, and `improve`. They are not code-quality lenses — they ask whether the repo's own records still match the changeset.

Each check yields **OK**, **Issue**, or **N/A**. Report all four every time, including the ones that pass — an all-`OK` result is the proof the checks ran, not a reason to omit them. In `improve` they render as the report's Housekeeping table (`improve-report.md`); in `check` and `run` they join the numbered findings.

Report what you find. Do not fix any of it as part of the check — `run` and `improve` both have their own approval step, and a housekeeping issue is often the user's deliberate in-progress state.

## 1. `context/history.md` order

Verify entries run chronologically, oldest first. A newer entry above an older one is an `Issue`.

## 2. `context/current-feature.md` alignment

Verify the goals and notes describe the work actually in the changeset — a feature doc that describes something else means one of the two is wrong, and the doc is the cheaper thing to be wrong.

**Never edit `## Status`.** The user owns the phase table.

`N/A` when the changeset touches no feature work.

## 3. Prisma migration sync

`N/A` unless `prisma/schema.prisma` is in the changeset.

Otherwise run `npx prisma migrate status` and confirm a migration exists for the schema change. A schema edit with no accompanying migration is an `Issue`.

Report it; never run a migration to resolve it. `boundary.md` is the only source of truth for what may run against this repo's schema and which database branch it may touch — read it there rather than recalling it.

## 4. Env drift

`N/A` unless the changeset touches an env file or the env types.

Otherwise compare the variable **names** across `.env.example`, `.env`, `.env.local`, `.env._production`, and `src/types/env.d.ts`. A variable that exists in any of them but is missing from `.env.example` is an `Issue` — `.env.example` is the documented contract, and a variable absent from it is one a fresh clone cannot know it needs.

Never print a value from `.env`, `.env.local`, or `.env._production` into the report or the transcript, redacted or otherwise. Name the variable; that is the whole finding.
