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

# Drop an EMPTY GCPBackendPolicy securityPolicy. When ARMOR_ENABLED != true, inject-settings
# leaves armorPolicyName="" and the kustomize replacement writes securityPolicy: "" — but GKE
# does NOT read that as "no policy". It builds the Cloud Armor URL ".../securityPolicies/<name>"
# with an empty name, the API rejects it as malformed, and the ENTIRE Gateway fails to program
# (Programmed=False), so the LB serves no backend and the site is unreachable. Deleting the field
# when empty is the documented "no policy attached" form; a non-empty value (prod armor) is left
# intact. yq '// ""' treats an absent field as empty too, so this is idempotent.
yq -i 'select(.kind == "GCPBackendPolicy" and (.spec.default.securityPolicy // "") == "") |= del(.spec.default.securityPolicy)' /tmp/rendered.yaml
