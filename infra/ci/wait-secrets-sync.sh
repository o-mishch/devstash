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
# infra/k8s/overlays/gcp/external-secrets.yaml and modules/iam/main.tf). That secret always has
# an ENABLED latest version by construction: the version resource is write-only
# (`secret_data_wo` + a hash-derived `secret_data_wo_version`) so a value change updates it IN
# PLACE rather than replacing it, and `deletion_policy = "DISABLE"` means a version is never
# DESTROYED. We STILL read it through ds_access_secret_blob (common.sh) — the same newest-ENABLED
# resolver every other reader of this secret uses (run.sh's app_config_blob, dns.sh's ops-config
# read) — rather than `access latest`: the write-only invariant makes `access latest` safe TODAY,
# but reading through the shared helper is defense-in-depth against a manual `versions disable`
# during an incident, and keeps this the one-and-only secret-read idiom in the tree instead of a
# lone `access latest` special case. What changes is the CONTENTS — the infra-derived keys are
# conditionally omitted (envs/dev/main.tf `app_secrets`):
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
# positively confirm the source blob is missing one of the expected infra properties. If every
# expected property IS present yet ESO still failed, the timeout fails the step loudly.
#
# A blob that is EMPTY / inaccessible (no ENABLED version at all) is ALSO a loud failure, NOT a
# benign parked state. The "always one enabled version" invariant above means an empty read can
# only come from a real fault — the secret was never created, IAM/WI access is broken, or a
# Terraform apply DISABLED the previous version without an enabled replacement. That last case is
# the disable-old-then-add-new race: the write-only version resource does the disable and the add
# as two API operations, so a deploy landing between them sees zero enabled versions. The CI
# enabled-version preflight gate (infra/ci/check-secret-version.sh) now blocks the deploy before
# this step whenever that gap is open, so reaching an empty blob here is an unexpected fault that
# must fail the build rather than silently pass it (which previously masked a full outage).
#
# The blob is read to inspect WHICH keys exist, never to print their values — we test key presence
# with `jq 'has(...)'` and emit only key NAMES, so no secret material reaches the CI log.
#
# Required env:
#   GCP_PROJECT_ID — from secrets (the project holding devstash-app-config)
set -euo pipefail

# shellcheck source=infra/lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"

NS="$DEVSTASH_NS"
ES=devstash-secrets
SM_SECRET=devstash-app-config

# The infra-derived properties ESO extracts that Terraform omits from the blob while the env is
# suspended / mid-resume. If ANY of these is absent, the not-Ready ExternalSecret is the expected
# partial-population state, not a real error. (Third-party keys like auth-secret are always
# present — their absence would be a genuine misconfig, so they are intentionally NOT listed here.)
INFRA_KEYS=(redis-url redis-ca-cert database-url direct-url database-ca-cert)

if kubectl -n "$NS" wait --for=condition=Ready "externalsecret/$ES" --timeout=180s; then
  echo "ExternalSecret '$ES' is Ready — secrets synced."
  echo "synced=true" >> "$GITHUB_OUTPUT"
  exit 0
fi

# The wait timed out. Distinguish an expected partial-population state from a real failure by
# reading the source blob and checking whether every infra property ESO needs is present.
echo "ExternalSecret '$ES' did not become Ready within the timeout — inspecting '$SM_SECRET' for the expected infra properties…"

# Read the newest ENABLED version via the shared helper (see header) — never `access latest`.
blob="$(ds_access_secret_blob "$SM_SECRET" "$GCP_PROJECT_ID")"

if [ -z "$blob" ]; then
  # No accessible ENABLED version at all. This is NOT the benign suspend/parked state — a
  # suspend only OMITS the redis-*/database-* PROPERTIES from a still-populated blob (handled
  # by the missing-infra-property branch below); it never leaves the secret with zero enabled
  # versions. By construction devstash-app-config ALWAYS has one enabled latest version (the
  # write-only + deletion_policy=DISABLE design in modules/iam/main.tf), so an empty read means
  # a genuine fault: the secret was never created, IAM/Workload-Identity access is broken, or a
  # Terraform apply disabled the previous version WITHOUT an enabled replacement (the
  # disable-old-then-add-new race — see the CI enabled-version preflight gate that now blocks the
  # deploy before it reaches this step). Swallowing it as a warning turned that outage into a
  # green build; fail loudly instead so the real problem surfaces.
  echo "::error::'$SM_SECRET' has no accessible ENABLED version (empty or inaccessible) — this is a real fault, not a suspended env (suspend omits properties, never the whole secret). ESO cannot sync '$ES'. Check the secret has an enabled version (gcloud secrets versions list $SM_SECRET) and that Workload Identity access is intact. Recover with: bash infra/run/gcp/run.sh resume." >&2
  echo "synced=false" >> "$GITHUB_OUTPUT"
  exit 1
fi

# Collect the infra keys that are absent from the blob. `jq 'has($k)'` tests key presence only —
# values are never emitted, so nothing sensitive reaches the log.
missing=()
for k in "${INFRA_KEYS[@]}"; do
  if [ "$(printf '%s' "$blob" | jq --arg k "$k" 'has($k)')" != "true" ]; then
    missing+=("$k")
  fi
done

if [ "${#missing[@]}" -gt 0 ]; then
  echo "::warning::'$SM_SECRET' is present but missing infra properties [${missing[*]}] that ESO extracts for '$ES' — the dev env is suspended or mid-resume (Terraform omits redis-*/database-* keys until the env is fully active), so ESO cannot sync. Treating as an expected parked state and finishing without failing the build. Downstream migrate + rollout steps self-skip. Repopulate with: bash infra/run/gcp/run.sh resume (or a Terraform apply on the active env)."
  echo "synced=false" >> "$GITHUB_OUTPUT"
  exit 0
fi

echo "'$SM_SECRET' has every expected infra property but ESO still failed to sync '$ES' — this is a real error, not a suspended/mid-resume env. Failing the step." >&2
kubectl -n "$NS" describe "externalsecret/$ES" | sed -n '/Events:/,$p' >&2 || true
exit 1
