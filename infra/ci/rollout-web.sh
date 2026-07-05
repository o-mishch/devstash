#!/usr/bin/env bash
# Apply the digest-pinned web Deployment from the same render (render-manifests.sh →
# /tmp/rendered.yaml) AFTER migrations have landed — this is what triggers the rolling update
# to the new code. Same server-side apply, --field-manager=devstash-deploy, and
# --force-conflicts posture as apply-infra.sh (see that file for the full CSA→SSA + stable
# field-manager rationale): no imperative `kubectl set image`, and forcing is safe because
# base/deployment.yaml omits `replicas` (the HPA is its sole owner), so this never stomps the
# HPA's scaling. wait-rollout.sh gates on the resulting rollout completing.
set -euo pipefail

# shellcheck source=infra/lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"

# The web Deployment only. ssa_apply (common.sh) owns the --server-side / --force-conflicts /
# --field-manager=devstash-deploy flag set, single-sourced with apply-infra.sh (see that header
# for the full CSA→SSA + stable field-manager rationale).
ssa_apply 'select(.kind == "Deployment")'
