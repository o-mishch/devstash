#!/usr/bin/env bash
# Preflight: prove the control plane is actually reachable over the DNS endpoint BEFORE
# the build spends time on Helm. The get-gke-credentials step can be green while the DNS
# endpoint refuses this runner's request — historically caused by an IAM Condition on the
# deployer role (removed in a051ad7), and also possible if allow_external_traffic drifts
# off. Helm surfaces either as a cryptic "Kubernetes cluster unreachable: <html> 403" that
# reads like a Helm/chart fault. This probe hits the API server's /readyz path; a generic
# 403 HTML page means a Google-Front-End rejection, which we detect and translate into the
# two gates to check instead of a misleading downstream error.
#
# Required env:
#   CLUSTER, REGION
set -euo pipefail

# Fail fast if a required env var is missing; also silences shellcheck SC2153 for
# these workflow-provided uppercase vars (their lowercase lookalikes appear only in comments).
: "${CLUSTER:?CLUSTER is required}" "${REGION:?REGION is required}"

if out="$(kubectl get --raw='/readyz' 2>&1)"; then
  echo "Control plane reachable via DNS endpoint: ${out}"
  exit 0
fi

# A generic Google HTML 403 here is a Google-Front-End rejection at the DNS endpoint (not a
# named-permission IAM denial). Two independent gates can cause it — check both.
if printf '%s' "$out" | grep -qiE '403 \(Forbidden\)|That.{0,3}s an error'; then
  echo "::error::GKE DNS endpoint returned a generic HTTP 403 at the Google Front End — the control plane refused this runner."
  echo "::error::Gate 1 (IAM): a resource-name IAM Condition on the deployer role (modules/iam/main.tf deployer_gke) never matches over the DNS endpoint, which evaluates container.clusters.connect on the endpoint resource — this was the confirmed cause, fixed in a051ad7. Do NOT re-add such a condition."
  echo "::error::Gate 2 (network): allow_external_traffic drifted off. Confirm: gcloud container clusters describe ${CLUSTER} --region ${REGION} --format='value(controlPlaneEndpointsConfig.dnsEndpointConfig.allowExternalTraffic)'  # expect True"
  echo "::error::Reconcile drift with: tofu apply  (from infra/terraform/envs/dev)."
else
  # Not the generic-403 drift signature — this runner simply can't reach GCP (no
  # credentials, network unreachable, 412 precondition, etc.). Warn, don't fail the job.
  echo "::warning::Control plane not reachable over the DNS endpoint and this is not the generic-403 drift signature — treating GCP as unavailable and skipping the preflight:"
  printf '%s\n' "$out"
  exit 0
fi
exit 1
