#!/usr/bin/env bash
# Shellcheck every tracked shell script under infra/ at ERROR severity. Called by the
# infra-checks PR gate (.github/workflows/infra-checks.yml) and runnable locally the same way:
#   bash infra/ci/shellcheck-infra.sh
#
# WHY error severity, not the default (warning): the infra scripts carry a handful of long-standing
# warning-level false positives — SC2034 on vars that ARE used (sourced by lib/*.sh or read by the
# terraform lifecycle JSON), SC2178/SC2128 where shellcheck misreads a `local name missing=0` reuse
# as an array. Gating on -S error keeps the check meaningful (a real bug — unquoted expansion,
# undefined var, bad redirect — still fails the gate) without pinning the whole tree to a
# clean-warning bar or scattering per-line disables. Run `shellcheck` (no -S) locally to see them.
#
# Resolves REPO_ROOT from this script's own path so it works from any CWD. Passes the file list to a
# single shellcheck invocation so one non-zero exit fails the whole gate.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

# NUL-delimited so paths with spaces survive; sort for deterministic, reviewable output. A
# read-loop (not `mapfile -d`) keeps this runnable on macOS bash 3.2 as well as the CI runner.
scripts=()
while IFS= read -r -d '' f; do scripts+=("$f"); done \
  < <(find infra -name '*.sh' -type f -print0 | sort -z)
[[ ${#scripts[@]} -gt 0 ]] || { echo "no infra shell scripts found — nothing to check" >&2; exit 1; }

echo "Shellchecking ${#scripts[@]} infra scripts at error severity..."
shellcheck -S error "${scripts[@]}"
echo "shellcheck: clean (no error-level findings)"
