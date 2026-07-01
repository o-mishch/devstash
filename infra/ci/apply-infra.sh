#!/usr/bin/env bash
# Apply everything EXCEPT the web Deployment from the single render (render-manifests.sh →
# /tmp/rendered.yaml): Namespace, SA, ConfigMap, SecretStore/ExternalSecret, Service,
# Ingress, BackendConfig, ManagedCertificate, HPA, PDB. Existing web pods keep serving the
# PREVIOUS image until the post-migration rollout (rollout-web.sh) — so new code never
# reaches users ahead of its schema migration.
#
# --force-conflicts is REQUIRED and CORRECT — DO NOT remove it. This pipeline is the single
# declarative owner of these objects' spec fields. An object first created by a client-side
# `kubectl apply` (an earlier deploy, or a manual `kubectl apply -f`) owns its fields under
# the legacy field manager `kubectl-client-side-apply`. Server-side apply then refuses to
# overwrite those fields and fails with, e.g.:
#     error: Apply failed with 1 conflict: conflict with
#     "kubectl-client-side-apply" using external-secrets.io/v1: .spec.data
# --force-conflicts performs the one-time CSA→SSA ownership transfer the Kubernetes docs
# prescribe (moves the field to this SSA manager, then is a no-op on every subsequent run) —
# the same posture ArgoCD and Flux use by default. SAFE here because we only ever conflict on
# fields THIS manifest declares; controller-owned fields we don't declare (status, defaulted
# nodePorts, GKE-added Ingress annotations) are never in the stream, so never forced. The web
# Deployment is applied separately (rollout-web.sh) and base/deployment.yaml deliberately omits
# `replicas`, so forcing never fights the HPA. Do NOT "fix" a recurring conflict by reverting
# to client-side apply — that re-creates the legacy manager and the conflict returns.
set -euo pipefail

yq 'select(.kind != "Deployment")' /tmp/rendered.yaml \
  | kubectl apply --server-side --force-conflicts -f -
