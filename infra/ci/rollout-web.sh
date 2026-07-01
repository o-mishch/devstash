#!/usr/bin/env bash
# Apply the digest-pinned web Deployment from the same render (render-manifests.sh →
# /tmp/rendered.yaml) AFTER migrations have landed — this is what triggers the rolling update
# to the new code. Same server-side field manager and --force-conflicts posture as
# apply-infra.sh (see that file for the full CSA→SSA rationale): no imperative
# `kubectl set image`, and forcing is safe because base/deployment.yaml omits `replicas`
# (the HPA is its sole owner), so this never stomps the HPA's scaling. wait-rollout.sh gates
# on the resulting rollout completing.
set -euo pipefail

yq 'select(.kind == "Deployment")' /tmp/rendered.yaml \
  | kubectl apply --server-side --force-conflicts -f -
