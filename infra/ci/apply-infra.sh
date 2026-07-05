#!/usr/bin/env bash
# Apply everything EXCEPT the web Deployment from the single render (render-manifests.sh →
# /tmp/rendered.yaml): Namespace, SA, ConfigMap, SecretStore/ExternalSecret, Service,
# Gateway, HTTPRoute, GCPBackendPolicy, HealthCheckPolicy, HPA, PDB. Existing web pods keep
# serving the PREVIOUS image until the post-migration rollout (rollout-web.sh) — so new code
# never reaches users ahead of its schema migration.
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
#
# --field-manager=devstash-deploy: a STABLE, dedicated manager name (shared with rollout-web.sh)
# so ownership is auditable in .metadata.managedFields and the CSA→SSA transfer is a genuine
# one-time move. Without an explicit name kubectl uses the default "kubectl", which a human
# `kubectl apply`/`edit` also writes under — fragmenting ownership so --force-conflicts silently
# suppresses real drift on every run instead of surfacing it. Keep both applies on this name.
set -euo pipefail

# shellcheck source=infra/lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"

NS="$DEVSTASH_NS"

# ── One-time migration cleanup: GCE Ingress stack → Gateway API ──────────────
# The overlay no longer renders the legacy Ingress / BackendConfig / FrontendConfig /
# ManagedCertificate (replaced by Gateway + HTTPRoute + GCPBackendPolicy + HealthCheckPolicy +
# Certificate Manager). A plain SSA apply of the new render does NOT delete objects that fell out
# of the manifest set, so on the FIRST Gateway deploy the old Ingress — and its classic
# Application Load Balancer — would linger, costing money alongside the new Gateway LB. Delete the
# legacy objects explicitly. Idempotent + self-disabling: --ignore-not-found makes this a clean
# no-op on every deploy after the first (and on a fresh install that never had them).
kubectl -n "$NS" delete ingress devstash-web --ignore-not-found
kubectl -n "$NS" delete backendconfig devstash-backendconfig --ignore-not-found
kubectl -n "$NS" delete frontendconfig devstash-frontendconfig --ignore-not-found
kubectl -n "$NS" delete managedcertificate devstash-cert --ignore-not-found

# Everything except the web Deployment. ssa_apply (common.sh) owns the --server-side /
# --force-conflicts / --field-manager=devstash-deploy flag set, single-sourced with rollout-web.sh
# so the two applies can never drift on the field manager the CSA→SSA transfer depends on.
ssa_apply 'select(.kind != "Deployment")'
