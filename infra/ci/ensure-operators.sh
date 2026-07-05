#!/usr/bin/env bash
# CI-only wrapper: install External Secrets Operator and Stakater Reloader CONCURRENTLY.
# The two installs are fully independent — different Helm releases, different namespaces,
# no shared state — and each is a `helm upgrade --install ... --wait --timeout 5m`. Run
# back-to-back they cost up to ~10 min on a cold cluster; run in parallel that halves to
# ~5 min. Both MUST finish before apply-infra.sh (it applies the SecretStore/ExternalSecret
# whose CRDs ESO installs), so this wrapper joins on both before returning.
#
# Delegates to the SAME two scripts CI and run.sh already run individually
# (infra/ci/ensure-eso.sh, infra/ci/ensure-reloader.sh) — this wrapper adds ONLY the
# parallelism, so the chart/version/--set/failure-policy single-source-of-truth in those
# scripts is untouched. run.sh keeps calling them one at a time (infra/run/gcp/lib/gke.sh);
# only the deploy-gke.yml `deploy` job calls this wrapper.
#
# Both child scripts `source infra/versions.env` by RELATIVE path and expect the repo root
# as CWD — this wrapper is invoked from the repo root by the workflow, and backgrounding a
# script does not change its CWD, so that invariant holds for the children too.
#
# Output from the two children interleaves in the CI log; each line is prefixed with
# [eso] / [reloader] via a stream filter so it stays attributable. A non-zero exit from
# EITHER child fails this step — we join on both PIDs and OR their statuses rather than
# letting `set -e` abort on the first `wait`, so the second install is never left orphaned.
set -euo pipefail

# shellcheck source=infra/lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"

# Prefix every line of a child's merged stdout+stderr so interleaved logs stay readable.
prefix() { sed -e "s/^/[$1] /"; }

log "Installing External Secrets Operator ‖ Stakater Reloader (parallel)"

infra/ci/ensure-eso.sh 2>&1 | prefix eso &
eso_pid=$!
infra/ci/ensure-reloader.sh 2>&1 | prefix reloader &
reloader_pid=$!

# Join on both regardless of which finishes first; capture each status without letting the
# first non-zero `wait` trip `set -e` and skip the join on the other. A pipeline's exit
# status is its LAST command (the prefix sed) unless pipefail promotes an earlier failure —
# pipefail is set above, so a child script's failure propagates through its `| prefix`.
eso_status=0
reloader_status=0
wait "$eso_pid" || eso_status=$?
wait "$reloader_pid" || reloader_status=$?

if [[ "$eso_status" -ne 0 || "$reloader_status" -ne 0 ]]; then
  die "operator install failed (eso=$eso_status reloader=$reloader_status)"
fi

ok "ESO + Reloader installed; SecretStore/ExternalSecret CRDs available"
