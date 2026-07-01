#!/usr/bin/env bash
# Static safety analysis of every pending migration SQL file BEFORE anything is built or
# deployed. Catches dangerous statements (DROP COLUMN, lock-heavy ALTER, non-CONCURRENT
# index, column/table renames) that would cause downtime or data loss during a rolling
# update. Risk/Postgres/lock-timeout policy lives in the committed .pgfence.json
# (max-risk=low → medium/high findings fail while low-risk additive changes stay
# deployable); do NOT duplicate those values here or local and CI analysis drift. Fix a
# failing migration with the expand-contract pattern before merging.
#
# pgfence is a lockfile-pinned devDependency installed by `npm ci`. --no-install forbids
# npx from downloading a different package at deploy time.
#
# WHY shopt -s globstar: GitHub Actions runners use bash but globstar (**) is disabled by
# default. Without it, ** matches only one directory level, silently skipping
# prisma/migrations/<timestamp>_name/migration.sql (two levels deep). globstar must be set
# in the same shell before the glob is expanded.
set -euo pipefail

shopt -s globstar
npx --no-install pgfence analyze --ci prisma/migrations/**/migration.sql
