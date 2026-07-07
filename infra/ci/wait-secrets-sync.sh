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

# Nudge ESO to reconcile NOW instead of waiting out its refreshInterval (1h). Even once Secret
# Manager HAS an enabled version, ESO's controller may have latched onto a stale/disabled version
# from an earlier reconcile and be sitting on its poll interval before trying again. Annotating the
# ExternalSecret changes its metadata, which the controller watches and reconciles on
# immediately (documented force-sync pattern: https://external-secrets.io/latest/introduction/faq/).
# Best-effort: on a first-ever bring-up the resource may not exist yet, so a failure here is fine —
# the kubectl wait below still runs and reports the real state.
kubectl -n "$NS" annotate "externalsecret/$ES" "force-sync=$(date +%s)" --overwrite >/dev/null 2>&1 || true

# --timeout=900s (15 min): this is now the ONLY wait for the secret, so it must outlast the
# worst-case producer — a resume `tofu apply` whose Cloud-SQL/Memorystore-derived app-config blob
# lands its enabled version ~13 min in (observed 2026-07-07). The old 180s was safe only because a
# separate 5-min enabled-version gate ran first; with that gate removed, 180s would time out before
# a legitimately-slow apply enables the version. This is a condition-wait on the real Ready event
# (returns the instant ESO syncs), not a fixed sleep — the ceiling only bounds a genuinely stuck sync.
if kubectl -n "$NS" wait --for=condition=Ready "externalsecret/$ES" --timeout=900s; then
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

# ESO latched onto a DISABLED version from a reconcile that ran before the apply enabled the new
# version, and the force-sync annotation above (sent once, at the top of this script) didn't land in
# time to flip it within the 900s wait. Retry the nudge + wait ONCE — a bounded best-effort second
# chance, not a proven fix: it only helps if Secret Manager's enabled-version state changed in the
# interim (the earlier miss was itself racing a slower version-bump propagation to ESO); if the
# underlying cause is IAM/Workload Identity being fully broken, this costs 60s of CI time before an
# identical failure. Cannot turn a real fault into a false pass either way — it still requires
# `kubectl wait --for=condition=Ready` to observe Ready. A second miss after the re-nudge fails loudly.
if printf '%s' "$events" | grep -q 'is in DISABLED state'; then
  echo "'$ES' is stuck on a DISABLED secret version — re-nudging ESO and retrying once…"
  kubectl -n "$NS" annotate "externalsecret/$ES" "force-sync=$(date +%s)" --overwrite >/dev/null 2>&1 || true
  if kubectl -n "$NS" wait --for=condition=Ready "externalsecret/$ES" --timeout=60s; then
    echo "ExternalSecret '$ES' is Ready after the retry — secrets synced."
    echo "synced=true" >> "$GITHUB_OUTPUT"
    exit 0
  fi
  echo "'$ES' is still stuck on a DISABLED version after a re-nudge — this is a real error. Failing the step." >&2
  kubectl -n "$NS" describe "externalsecret/$ES" | sed -n '/Events:/,$p' >&2 || true
  exit 1
fi

echo "'$ES' failed to sync for a reason other than a missing infra property — this is a real error, not a suspended/mid-resume env. Failing the step." >&2
printf '%s\n' "$events" >&2
exit 1
