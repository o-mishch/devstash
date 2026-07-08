#!/usr/bin/env bash
# Wait for External Secrets Operator to materialize `devstash-secrets` (the K8s Secret the
# migrate Job and web pods consume via envFrom), block until it is Ready, THEN let the deploy
# proceed to DB migrations + rollout.
#
# Writes `synced=true|false` to $GITHUB_OUTPUT. The downstream migrate + rollout steps gate on
# `synced == 'true'` — when the source blob is only partially populated they self-skip instead
# of running against a cluster with no `devstash-secrets` (which would fail the migrate Job on
# missing DB creds, defeating the warn-and-finish).
#
# WARN-AND-FINISH on a partially-populated source blob. Every value ESO reads is a property of
# ONE Secret Manager secret, `devstash-app-config` (single-secret consolidation — see
# infra/k8s/overlays/gcp/external-secrets.yaml and modules/iam/main.tf). The infra-derived keys
# are conditionally omitted (envs/dev/main.tf `app_secrets`):
#   - redis-url / redis-ca-cert            → omitted whenever environment_active=false (any suspend)
#   - database-url / direct-url / database-ca-cert → omitted whenever db_active=false (deep suspend)
# So the failure mode that stalls this step is NOT a destroyed/absent secret — it is the blob
# being present but missing those `remoteRef.property` paths. ESO then reports SecretSyncedError
# ("failed to find secret data ... property") and the ExternalSecret never goes Ready, so the
# `kubectl wait` times out. That happens when a merge to main (or a bare `apply`) lands while the
# env is suspended or MID-RESUME — the GKE cluster already exists (so the coarse check-env-active
# preflight passes and this job runs) but Terraform has not yet repopulated the infra keys. It is
# an EXPECTED transient/parked state, not a broken deploy, so we surface a ::warning:: and exit 0
# instead of failing the build (mirrors check-env-active.sh's warn-and-skip philosophy).
#
# A genuine sync failure (ESO misconfig, Workload Identity broken, a fully-populated blob that
# still won't sync) is deliberately NOT swallowed: we only treat the timeout as benign when we can
# positively confirm ESO's own failure event names a missing infra property. If the failure event
# says anything else (or there is no failure event at all), the timeout fails the step loudly.
#
# THIS IS THE SOLE SECRET-READINESS JOIN (the separate check-secret-version.sh enabled-version gate
# was removed 2026-07-07). The ExternalSecret's `Ready=True` condition is a real Kubernetes event
# that becomes true EXACTLY when ESO has read an ENABLED devstash-app-config version and materialized
# devstash-secrets — so "Ready" already implies "an enabled version exists". Waiting on that
# condition (the `kubectl wait --for=condition=Ready` below) is an event-based join, not a poll of
# Secret Manager. The old enabled-version gate polled a fixed 5-min window and RACED a resume apply
# whose disable-old→add-new secret bump legitimately took ~13 min (the apply computes the blob from
# Cloud SQL/Memorystore outputs, so it lands mid-apply — it cannot be front-loaded); the gate lost
# and failed the deploy. Since Ready subsumes the enabled-version check and its failure branches
# below already fail loudly on a genuinely broken/empty secret, the gate was redundant. The wait
# timeout is sized (below) to outlast that worst-case apply so this join never loses the same race.
#
# A sync failure that is NOT explained by a missing infra property (see below) is a real fault
# and must fail the build rather than silently pass it (which previously masked a full outage).
#
# Diagnosis reads ESO's own Kubernetes Events, never Secret Manager directly — the deployer SA
# that runs this script only holds secretmanager.viewer (list/metadata; see modules/iam/main.tf's
# deployer_secret_viewer), not secretAccessor, so it cannot read devstash-app-config's payload.
# ESO reads the payload itself (as the app SA, via Workload Identity) and, on failure, emits a
# `reason=UpdateFailed` Event whose message is the raw provider error string. For a missing
# `remoteRef.property` that message contains "does not exist in secret" (GCP provider:
# `key %s does not exist in secret %s`) — that substring is the one thing we grep for; we never
# need to fetch or parse the blob ourselves.
#
# Required env:
#   GCP_PROJECT_ID — from secrets (the project holding devstash-app-config)
set -euo pipefail

# shellcheck source=infra/lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"

NS="$DEVSTASH_NS"
ES=devstash-secrets
SM_SECRET=devstash-app-config

# Overall budget (15 min) the secret sync is allowed — must outlast the worst-case producer, a
# resume `tofu apply` whose Cloud-SQL/Memorystore-derived app-config blob lands its enabled version
# ~13 min in (observed 2026-07-07). NUDGE_INTERVAL is how long each inner `kubectl wait` blocks
# before we re-nudge. Both env-overridable for tests. This is the ONLY wait for the secret (the
# separate 5-min enabled-version gate was removed 2026-07-07), so the budget must cover the slow apply.
: "${SECRET_SYNC_TIMEOUT:=900}"
: "${SECRET_SYNC_NUDGE_INTERVAL:=30}"

# RE-NUDGE ON EVERY ITERATION, not once. ESO's refreshInterval is 1h, so once its controller
# reconciles and reads a stale/disabled/absent version (the write-only Terraform version bump
# disables the old version then adds the new one as two separate Secret Manager ops, so a reconcile
# that lands in that gap sees a DISABLED-or-absent version), it FAILS and then sits IDLE for up to an
# hour before retrying on its own. A single force-sync annotation at the top therefore only helps if
# the enabled version already exists at that instant; if it lands seconds later (the common resume
# race), that one nudge is wasted and a plain `kubectl wait` blocks the full budget against an idle
# controller — self-healing only after the whole timeout expires (or, previously, needing a manual
# `kubectl annotate` to unstick it). Instead, annotate → wait a short interval → if not Ready, re-
# annotate and repeat: each annotation is a metadata write the controller watches and reconciles on
# immediately (documented force-sync pattern: https://external-secrets.io/latest/introduction/faq/),
# so ESO re-reads Secret Manager every NUDGE_INTERVAL and picks up the enabled version within one
# interval of it appearing — no manual intervention, no burning the full budget on an idle latch.
# Still a condition-wait on the real Ready event (returns the instant ESO syncs); the loop only
# bounds how long we keep re-nudging before classifying the failure below.
echo "Waiting up to ${SECRET_SYNC_TIMEOUT}s for '$ES' to sync, re-nudging ESO every ${SECRET_SYNC_NUDGE_INTERVAL}s (its 1h refreshInterval means it will not re-read a mid-bump version on its own)…"
secret_sync_deadline=$(( $(date +%s) + SECRET_SYNC_TIMEOUT ))
synced=false
while :; do
  # Best-effort annotate: on a first-ever bring-up the resource may not exist yet, so a failure here
  # is fine — the wait below still runs and reports the real state.
  kubectl -n "$NS" annotate "externalsecret/$ES" "force-sync=$(date +%s)" --overwrite >/dev/null 2>&1 || true
  if kubectl -n "$NS" wait --for=condition=Ready "externalsecret/$ES" --timeout="${SECRET_SYNC_NUDGE_INTERVAL}s" >/dev/null 2>&1; then
    synced=true
    break
  fi
  # Stop once the overall budget is spent (a short final interval that would overrun is not started).
  [ "$(date +%s)" -lt "$secret_sync_deadline" ] || break
done

if [ "$synced" = true ]; then
  echo "ExternalSecret '$ES' is Ready — secrets synced."
  echo "synced=true" >> "$GITHUB_OUTPUT"
  exit 0
fi

# The wait timed out. Distinguish an expected partial-population state (Terraform hasn't
# repopulated the infra-derived properties yet — suspended/mid-resume env) from a real failure by
# reading ESO's own sync-failure Events instead of the Secret Manager payload (see header).
echo "ExternalSecret '$ES' did not become Ready within the timeout — inspecting its sync-failure events…"

# --sort-by=.lastTimestamp + take only the LAST item: repeated identical failures aggregate onto
# one Event object (count/lastTimestamp bump in place), but a DIFFERENT failure reason creates a
# separate object that coexists until its TTL expires. Without sorting + taking only the newest,
# a stale benign Event from an earlier resolved period could still satisfy the "does not exist in
# secret" grep below even while a concurrent, unrelated real fault is the CURRENT failure — exactly
# the kind of stale-signal-masks-a-live-outage bug this script exists to prevent (the write-only
# Terraform version bump disables the old version then adds the new one as two separate Secret
# Manager operations, so a reconcile can momentarily see a disabled/absent version).
#
# stderr is captured (not discarded) and rc checked explicitly: a kubectl failure (RBAC denial, API
# server unreachable, transient network error) must not be folded into "no event found" — both
# currently fail the build either way, but conflating them would hide the real cause from whoever
# is debugging, and would become a live bug the moment the no-event branch is ever loosened.
errfile="$(mktemp)"
rc=0
events="$(kubectl -n "$NS" get events --field-selector "involvedObject.name=$ES,reason=UpdateFailed" --sort-by=.lastTimestamp -o jsonpath='{.items[-1:].message}' 2>"$errfile")" || rc=$?
kubectl_err="$(cat "$errfile")"
rm -f "$errfile"

if [ "$rc" -ne 0 ]; then
  echo "'$ES': kubectl get events failed (rc=$rc) — this is a real error, not a suspended/mid-resume env. Failing the step." >&2
  printf '%s\n' "$kubectl_err" >&2
  exit 1
fi

if [ -z "$events" ]; then
  echo "'$ES' has no UpdateFailed events — this is a real error, not a suspended/mid-resume env. Failing the step." >&2
  kubectl -n "$NS" describe "externalsecret/$ES" | sed -n '/Events:/,$p' >&2 || true
  exit 1
fi

if printf '%s' "$events" | grep -q 'does not exist in secret'; then
  echo "::warning::'$ES' is missing a property that '$SM_SECRET' only populates once the env is fully active — the dev env is suspended or mid-resume (Terraform omits redis-*/database-* keys until then), so ESO cannot sync. Treating as an expected parked state and finishing without failing the build. Downstream migrate + rollout steps self-skip. Repopulate with: bash infra/run/gcp/run.sh resume (or a Terraform apply on the active env)."
  echo "synced=false" >> "$GITHUB_OUTPUT"
  exit 0
fi

# A DISABLED-version failure that SURVIVED the re-nudge loop is now a real fault, not a transient
# race. The loop above already re-annotated ESO every SECRET_SYNC_NUDGE_INTERVAL for the full budget,
# so ESO re-read Secret Manager many times — the mid-bump gap (Terraform disables the old version
# then adds the new one as two ops) heals within one interval of the enabled version appearing, and
# the loop would have caught it. Reaching here means NO enabled version ever materialized within the
# whole SECRET_SYNC_TIMEOUT (a stuck/failed apply that never enabled a new version, or one still
# absent when the budget expired). Another single 60s nudge cannot fix that — surface it loudly so
# the operator investigates the producing apply instead of the deploy silently greening or hanging.
if printf '%s' "$events" | grep -q 'is in DISABLED state'; then
  echo "'$ES' is stuck on a DISABLED secret version after re-nudging ESO for the full ${SECRET_SYNC_TIMEOUT}s — no ENABLED '$SM_SECRET' version materialized in time. This is a real error (the producing apply never enabled a new version), not a mid-resume race. Failing the step." >&2
  kubectl -n "$NS" describe "externalsecret/$ES" | sed -n '/Events:/,$p' >&2 || true
  exit 1
fi

echo "'$ES' failed to sync for a reason other than a missing infra property — this is a real error, not a suspended/mid-resume env. Failing the step." >&2
printf '%s\n' "$events" >&2
exit 1
