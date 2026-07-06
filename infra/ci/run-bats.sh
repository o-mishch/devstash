#!/usr/bin/env bash
# Run the infra bats suite, parallelised across files when GNU `parallel` is available.
#
# WHY A WRAPPER (not `bats --jobs N` inline in package.json): `bats --jobs` REQUIRES GNU `parallel`
# on PATH and exits 1 without running a single test when it is absent — so a hard `--jobs` would
# break `npm run test:infra` for any contributor who has not installed `parallel` (it is not a
# transitive dep of bats-core). GitHub's `ubuntu-latest` runner ships `parallel` preinstalled, so
# CI parallelises for free; a laptop without it falls back to the (correct, just slower) serial run.
# One script keeps that detection in ONE place instead of duplicating it across package.json + CI.
#
# SAFETY UNDER PARALLEL: each test's stubs live in $BATS_TEST_TMPDIR (unique per test, even across
# jobs — see infra/lib/test_helper.bash's per-test bindir isolation), and the one shared file the
# suite touches, node_modules/bats-mock/binstub, is only READ (symlinked to) by `stub`, never
# written. The suite was validated at 87/87 across repeated `--jobs` runs. The across-files split is
# bounded by the slowest single file (the state-lock suite, ~11s), so JOBS beyond the file count
# buys nothing — 14 is a comfortable ceiling for the current 9 files.
#
# Override the degree of parallelism with BATS_JOBS=<n>; set BATS_JOBS=1 to force serial.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."   # repo root — bats paths + node_modules resolve from here

jobs="${BATS_JOBS:-14}"
bats="node_modules/.bin/bats"

if [[ "$jobs" != "1" ]] && command -v parallel >/dev/null 2>&1; then
  exec "$bats" --jobs "$jobs" --recursive infra
fi

# Serial fallback: no `parallel`, or BATS_JOBS=1. Correct, just slower — surface why so a dev who
# wants the speedup knows the one thing to install.
if [[ "$jobs" != "1" ]]; then
  printf "» GNU 'parallel' not found — running bats serially. Run 'brew install parallel' for ~3x faster infra tests.\n" >&2
fi
exec "$bats" --recursive infra
