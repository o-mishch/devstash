#!/usr/bin/env bash
# Render the GCP overlay ONCE to /tmp/rendered.yaml so the infra apply and the
# post-migration web rollout both apply the exact same output (a real migrate→rollout gate,
# not the old :latest race). Database (Cloud SQL) + Redis (Memorystore) are Terraform-managed
# and not in this overlay; the migrate Job is applied separately (gated) by run-migrations.sh.
# The split-apply consumers are apply-infra.sh (everything except the Deployment) and
# rollout-web.sh (the Deployment) — both read the /tmp/rendered.yaml written here.
set -euo pipefail

cd infra/k8s/overlays/gcp
kubectl kustomize . > /tmp/rendered.yaml
