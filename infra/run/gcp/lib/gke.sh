# shellcheck shell=bash
# GKE/kubectl-facing operations for the GCP deploy tooling. SOURCED by infra/run/gcp/run.sh
# (never executed) — it shares run.sh's shell scope, so the functions here rely on state the
# parent already established. Split out of run.sh purely to keep that orchestrator readable;
# this is organisational, not a standalone module.
#
# Depends on (provided by run.sh before this file is sourced):
#   globals   PROJECT_ID, NS, ESO_VERSION, RELOADER_VERSION
#   helpers   log/ok/warn/die (infra/lib/common.sh), tofu_, tf_out, confirm, poll_until,
#             ensure_tfvars
#
# Source-guard: sourcing twice is a harmless no-op.
[[ -n "${_DEVSTASH_GCP_GKE_SH:-}" ]] && return 0
_DEVSTASH_GCP_GKE_SH=1

# _kube_context_is_gke: true iff the CURRENT kubectl context looks like a GKE context
# (gcloud always names them "gke_<project>_<location>_<cluster>"). Belt-and-suspenders check
# after use_cluster/use_cluster_soft's `eval "$c"`: that eval already targets the exact
# project/cluster from tofu output, so in the normal case this can't fail — but `eval` inside
# `use_cluster_soft`'s `... || warn` swallows a failed get-credentials silently, which would
# otherwise leave kubectl pointed at whatever context (e.g. local kind) was active before the
# call, and every kubectl command downstream would then silently run against the wrong cluster.
_kube_context_is_gke() {
  local ctx; ctx="$(kubectl config current-context 2>/dev/null || true)"
  [[ "$ctx" == gke_* ]]
}

# use_cluster / use_cluster_soft: point kubeconfig at the GKE cluster via the tofu-emitted
# get_credentials_command. `use_cluster` aborts if no cluster exists; the _soft variant only
# warns and continues (for read-only status/log commands that still work partially offline).
# Optional $1 overrides the default message. Guard on the `gcloud*` prefix before eval-ing:
# when the env is suspended, get_credentials_command is a human-readable sentinel (NOT a gcloud
# command), so eval-ing it is meaningless — bail with the same message as a missing cluster.
# Centralising this one guard makes every caller (apply/eso/status/rotate-secret/
# verify-secrets/upgrade-helm/logs) sentinel-safe and GKE-context-safe consistently.
use_cluster() {
  local c; c="$(tofu_ output -raw get_credentials_command 2>/dev/null || true)"
  [[ "$c" == gcloud* ]] || die "${1:-no cluster yet — run 'apply' first}"
  eval "$c"
  _kube_context_is_gke || die "get-credentials ran but kubectl context is not a GKE context ('$(kubectl config current-context 2>/dev/null)') — refusing to proceed against a possibly-wrong cluster"
}
use_cluster_soft() {
  local c; c="$(tofu_ output -raw get_credentials_command 2>/dev/null || true)"
  [[ "$c" == gcloud* ]] || { warn "${1:-no cluster yet}"; return 0; }
  eval "$c" 2>/dev/null || { warn "${1:-no cluster yet}"; return 0; }
  _kube_context_is_gke || warn "get-credentials ran but kubectl context is not a GKE context ('$(kubectl config current-context 2>/dev/null)') — subsequent kubectl calls may target the wrong cluster"
}

# helm_repo (register + refresh a chart repo) now lives in infra/lib/common.sh so the ensure-*.sh
# CI installers share it too; upgrade_helm below still calls it to freshen both repos before
# querying latest versions.

# _wait_eso_webhook: block until ESO's validating webhook Deployment is rolled out. The Helm
# chart's own --wait covers the ESO Deployments, but CR-admission ALSO needs this webhook live
# before the overlay's SecretStore is accepted — so both the serial eso() and the parallel
# ensure_operators() run this same belt-and-suspenders wait after the install. Single-sourced so
# the namespace/deploy-name/timeout can't drift between the two install paths.
_wait_eso_webhook() {
  kubectl -n external-secrets rollout status deploy/external-secrets-webhook --timeout=3m
}

# External Secrets Operator — required ONCE per cluster before any `kubectl apply -k`,
# because the gcp overlay ships SecretStore/ExternalSecret CRs whose CRDs ESO installs.
# Without it, CI's apply fails ("no matches for kind SecretStore") and pods never get
# their secrets. ESO authenticates via Workload Identity (no static key) — see
# external-secrets.yaml. Idempotent: `helm upgrade --install` + a CRD/rollout wait.
# NOTE: this function also calls reloader() at the end — `run.sh eso` installs both.
# Use `run.sh reloader` to reinstall Reloader alone without touching ESO.
eso() {
  log "Installing External Secrets Operator (idempotent)"
  use_cluster
  # Delegate the actual helm install to the SAME script CI runs (infra/ci/ensure-eso.sh) —
  # one source of truth for the chart, --version (from versions.env), the Autopilot 50m
  # --set block, and the failure policy (HELM_FAILURE_POLICY, overridden above for local
  # Helm). run.sh only adds the cluster-cred fetch above and the webhook wait below; the
  # install itself never diverges from CI again.
  infra/ci/ensure-eso.sh
  _wait_eso_webhook   # CR-admission needs the validating webhook live before SecretStore is accepted
  ok "ESO installed; SecretStore/ExternalSecret CRDs available"

  reloader
}

# Stakater Reloader — required ONCE per cluster (also installed by CI on every deploy).
# Watches the devstash-secrets K8s Secret and rolls Deployment pods when ESO refreshes
# it from Secret Manager, so secret updates propagate without a manual rollout restart.
# Without Reloader the secret.reloader.stakater.com/reload annotation on the Deployment
# is inert and updated secrets only take effect on the next manual deploy.
# Idempotent: `helm upgrade --install` is a no-op when already at the pinned version.
# Pin the same version used in deploy-gke.yml to keep bootstrap and CI in sync.
reloader() {
  log "Installing Stakater Reloader (idempotent)"
  use_cluster
  # Same single-source-of-truth delegation as eso(): infra/ci/ensure-reloader.sh owns the
  # chart, --version, --set, and the failure policy (HELM_FAILURE_POLICY) shared with CI.
  infra/ci/ensure-reloader.sh
  ok "Stakater Reloader installed; Deployment auto-restarts on secret rotation"
}

# _join_fail_fast_hook <hook-fn> <die-msg> <pid…>: fail-fast join over a set of backgrounded PIDs,
# with a hook that can add MORE pids as jobs complete. Returns 0 only once ALL (original + hook-
# added) exit 0; the instant the FIRST exits non-zero it kills every still-running sibling (so
# nothing is left installing/creating detached after we abort) and `die`s with <die-msg>. Uses
# `wait -n -p` (bash >= 5.1, guaranteed by run.sh's re-exec) to learn WHICH pid finished each
# iteration so the pending set shrinks by one and, on failure, only the survivors are killed.
#
# THE HOOK: after each pid finishes 0, <hook-fn> is CALLED DIRECTLY (not in a command substitution)
# with that pid as $1. To fold in a new dependency-gated job (e.g. a DB restore that can only start
# once the apply pid completes), the hook spawns it with `&` and appends the pid to the caller-shared
# array `_JOIN_NEW_PIDS`; the loop then moves those into the pending set and re-clears the array.
# The hook MUST NOT return the pid via stdout — a `$(hook)` command substitution runs in a subshell,
# so a job it backgrounds is a child of THAT subshell and dies un-waitable when the substitution ends
# (the exact bug this design avoids). Calling the hook plainly keeps the spawned job a child of THIS
# loop's shell, so `wait` can join it. The hook fires ONLY on success (the fail-fast branch aborts
# first), so a gated job never starts after a failed dependency. Pass `:` for a plain join (it never
# touches _JOIN_NEW_PIDS, so nothing is added).
#
# Single-sourced so ensure_operators (plain join) and suspend.sh's resume overlap driver (hooked
# join that spawns the apply-gated restore) share ONE loop instead of copy-pasting this logic.
_join_fail_fast_hook() {
  local hook_fn="$1" die_msg="$2"; shift 2
  local pending=("$@")
  local finished rc p kept
  # _JOIN_NEW_PIDS is the hook→loop channel: the hook appends spawned pids here (see header). Declared
  # here so a `:` no-op hook simply leaves it empty. Not `local`-shadowed inside the hook — dynamic
  # scope lets the hook see and append to this exact array.
  local _JOIN_NEW_PIDS=()
  while [[ "${#pending[@]}" -gt 0 ]]; do
    finished=""; rc=0
    wait -n -p finished "${pending[@]}" || rc=$?
    # `wait -n` returns 127 with an EMPTY `finished` when no listed pid is a waitable child anymore (a
    # job already reaped) — NOT a job failure. Distinguish by whether we learned a finished pid: rc!=0
    # WITH a finished pid is a real non-zero job exit; rc!=0 WITHOUT one means pids vanished, so prune
    # the no-longer-alive ones and re-wait. (Guarding on `finished` empty, not the bare 127, also
    # avoids ever masking a genuine job exit code of 127.)
    if [[ "$rc" -ne 0 && -z "$finished" ]]; then
      kept=()
      for p in "${pending[@]}"; do kill -0 "$p" 2>/dev/null && kept+=("$p"); done
      pending=(${kept[@]+"${kept[@]}"})
      continue
    fi
    if [[ "$rc" -ne 0 ]]; then
      # A tracked job exited non-zero — kill any still-running siblings before aborting so nothing is
      # left compiling/installing/creating detached, then die. `kill` on an already-exited pid is a no-op.
      for p in "${pending[@]}"; do [[ "$p" != "$finished" ]] && kill "$p" 2>/dev/null || true; done
      die "$die_msg (a joined job exited $rc)"
    fi
    # Rebuild the pending set without the just-finished pid. If -p reported nothing (shouldn't on
    # >=5.1), fall back to clearing all — every tracked job has exited 0 by then anyway.
    if [[ -n "$finished" ]]; then
      kept=()
      for p in "${pending[@]}"; do [[ "$p" != "$finished" ]] && kept+=("$p"); done
      pending=(${kept[@]+"${kept[@]}"})
      # Let the hook react to THIS pid finishing. Called PLAINLY (not `$(...)`) so any job it spawns
      # is a child of this shell; it appends the pid(s) to _JOIN_NEW_PIDS, which we then fold in.
      _JOIN_NEW_PIDS=()
      "$hook_fn" "$finished"
      [[ "${#_JOIN_NEW_PIDS[@]}" -gt 0 ]] && pending+=("${_JOIN_NEW_PIDS[@]}")
    else
      pending=()
    fi
  done
  # The `while` exits with its false condition's status (1) — return 0 explicitly so a clean drain
  # (all jobs 0) is a success, not the loop-condition's non-zero.
  return 0
}

# _join_fail_fast <die-msg> <pid…>: the hookless join — a plain fail-fast wait over a fixed pid set.
# Thin wrapper over _join_fail_fast_hook with a no-op hook (`:` never touches _JOIN_NEW_PIDS, so no
# pids are ever added).
_join_fail_fast() { _join_fail_fast_hook : "$@"; }

# _prefix <tag>: stream filter that prefixes each stdout line with "[tag] " so the interleaved
# output of concurrently-backgrounded steps stays attributable. Shared by ensure_operators and
# the resume overlap driver (which prefixes [apply]/[restore]).
_prefix() { sed -e "s/^/[$1] /"; }

# ensure_operators: install ESO + Reloader CONCURRENTLY (the two are fully independent — different
# releases, namespaces, no shared state; see infra/ci/ensure-operators.sh, which does the same for
# the CI deploy job). run.sh's serial eso()→reloader() ran them back-to-back; this overlaps them,
# saving the shorter install's duration on a cold cluster. It is the bring-up path's replacement for
# calling eso() (which chains reloader()); the standalone `run.sh eso`/`reloader` commands still use
# the serial functions above.
#
# KUBECONFIG SAFETY: use_cluster (which runs `gcloud … get-credentials`, MUTATING the shared
# kubeconfig + current-context) is called ONCE HERE, in the parent, BEFORE any backgrounding.
# Concurrent get-credentials calls corrupt the central kubeconfig or flip the context out from under
# each other (documented GKE/CI race), so it must never run inside the backgrounded installs — the
# ensure-*.sh scripts deliberately do NOT fetch creds; they inherit the context set here. The two
# backgrounded helm installs then only READ that kubeconfig (no context switch), the same safe
# pattern CI's ensure-operators.sh already runs in production.
#
# EXTRA OVERLAP: any PID passed as an argument (e.g. a backgrounded DB restore) is joined alongside
# the two installs via _join_fail_fast, so an independent long task overlaps the operator install
# under one fail-fast wait instead of a second serial wait. (resume's own overlap driver uses the
# HOOKED join instead — see suspend.sh:_apply_and_wire_cluster_overlapped — because its restore is
# dependency-gated on the apply finishing rather than already backgrounded.)
ensure_operators() {
  local extra_pids=("$@")   # optional already-backgrounded PIDs to join with the installs
  use_cluster               # ONCE, in the parent — sets kubeconfig + context before backgrounding
  log "Installing External Secrets Operator ‖ Stakater Reloader (parallel)"
  { infra/ci/ensure-eso.sh 2>&1 | _prefix eso; exit "${PIPESTATUS[0]}"; } &
  local eso_pid=$!
  { infra/ci/ensure-reloader.sh 2>&1 | _prefix reloader; exit "${PIPESTATUS[0]}"; } &
  local reloader_pid=$!
  # Join the two installs + any caller-supplied PIDs (e.g. a backgrounded DB restore or apply exec)
  # under one fail-fast wait — see _join_fail_fast above.
  _join_fail_fast \
    "operator/restore overlap failed — re-run the bring-up (all steps are retry-safe)" \
    "$eso_pid" "$reloader_pid" ${extra_pids[@]+"${extra_pids[@]}"}
  _wait_eso_webhook   # same belt-and-suspenders webhook wait eso() does — see the helper above
  ok "ESO + Reloader installed; SecretStore/ExternalSecret CRDs available"
}

# upgrade-helm: bump ESO and Reloader to their latest published Helm chart versions.
# Checks `helm search repo` for each chart, updates infra/versions.env in-place, and
# re-installs both charts on the live cluster (via eso → infra/ci/ensure-*.sh). Safe to run
# at any time — `helm upgrade --install` is idempotent and the failure policy
# (HELM_FAILURE_POLICY) rolls the release back on failure.
#
# HOW IT WORKS:
#   1. Ensures both repos are registered and fresh (repo update).
#   2. Fetches the latest chart version for each using `helm search repo --output json`.
#   3. Compares against the current versions.env values — skips if already at latest.
#   4. Writes the new versions to versions.env (sed in-place).
#   5. Calls eso (reinstalls ESO + Reloader) so the live cluster matches.

# _set_versions_env <key> <value>: rewrite `KEY=…` in-place in "$versions_file". The `.bak`
# temp + explicit rm is the portable BSD/GNU form of `sed -i` (macOS sed requires an argument
# to -i; GNU accepts an empty one). Single-sources the in-place edit the ESO/Reloader bumps
# below both perform. Relies on the caller's `versions_file` local being in scope.
_set_versions_env() { sed -i.bak "s/^$1=.*/$1=$2/" "$versions_file" && rm -f "$versions_file.bak"; }

upgrade_helm() {
  ensure_tfvars
  use_cluster

  log "Checking for Helm chart updates"
  helm_repo external-secrets https://charts.external-secrets.io
  helm_repo stakater https://stakater.github.io/stakater-charts

  local latest_eso latest_reloader
  latest_eso="$(helm search repo external-secrets/external-secrets --output json | jq -r '.[0].version')"
  latest_reloader="$(helm search repo stakater/reloader --output json | jq -r '.[0].version')"

  [[ -n "$latest_eso" ]]      || die "could not fetch latest ESO chart version"
  [[ -n "$latest_reloader" ]] || die "could not fetch latest Reloader chart version"

  local versions_file
  versions_file="$(dirname "${BASH_SOURCE[0]}")/../../../versions.env"

  if [[ "$ESO_VERSION" == "$latest_eso" ]]; then
    ok "ESO already at latest ($ESO_VERSION)"
  else
    warn "ESO: $ESO_VERSION → $latest_eso (check release notes before upgrading)"
    if confirm "Upgrade ESO from $ESO_VERSION to $latest_eso?"; then
      _set_versions_env ESO_VERSION "$latest_eso"
      ESO_VERSION="$latest_eso"
      ok "versions.env updated: ESO_VERSION=$latest_eso"
    fi
  fi

  if [[ "$RELOADER_VERSION" == "$latest_reloader" ]]; then
    ok "Reloader already at latest ($RELOADER_VERSION)"
  else
    warn "Reloader: $RELOADER_VERSION → $latest_reloader (check release notes before upgrading)"
    if confirm "Upgrade Reloader from $RELOADER_VERSION to $latest_reloader?"; then
      _set_versions_env RELOADER_VERSION "$latest_reloader"
      RELOADER_VERSION="$latest_reloader"
      ok "versions.env updated: RELOADER_VERSION=$latest_reloader"
    fi
  fi

  log "Applying Helm chart versions to the cluster (eso + reloader)"
  eso
}

# _app_healthy <domain>: deep health check that passes ONLY when the JSON body reports
# status "ok". The health contract (why HTTP 200 alone is not enough) lives in ds_health_ok
# (infra/lib/common.sh), shared with local run.sh's deep_health_check.
_app_healthy() {
  ds_health_ok "https://${1}/api/health?deep=1"
}

# status: print a quick health snapshot of the running environment.
# Shows workloads, pods, ESO sync state, managed TLS cert, Ingress IP, and the
# deep health endpoint. Useful to poll after `deploy` or `dns_hint` while waiting
# for the cert to become Active.
status() {
  log "Cluster status"
  use_cluster_soft

  echo
  log "Workloads"
  kubectl -n "$NS" get deploy,statefulset,job,gateway,httproute 2>/dev/null || true

  echo
  log "Pods"
  kubectl -n "$NS" get pods -o wide 2>/dev/null || true

  echo
  log "ExternalSecrets (ESO sync)"
  kubectl -n "$NS" get externalsecret 2>/dev/null || warn "no externalsecrets (ESO not installed?)"

  echo
  log "Gateway + TLS certificate (Certificate Manager)"
  kubectl -n "$NS" get gateway devstash-web -o wide 2>/dev/null \
    || warn "Gateway not found — overlay not applied yet"
  # TLS is served by the project-scoped Certificate Manager cert (envs/dev/certmanager.tf), NOT a
  # cluster ManagedCertificate. It survives suspend and provisions ONCE (first-time only). Report
  # its managed state so an operator can confirm ACTIVE.
  local cert_name
  cert_name="$(tf_out cert_name)"
  if [[ -n "$cert_name" ]]; then
    echo -n "  Cert '$cert_name' state: "
    gcloud certificate-manager certificates describe "$cert_name" --project="$PROJECT_ID" \
      --format='value(managed.state)' 2>/dev/null || echo "unknown (run 'apply' first)"
  fi
  warn "First-time only: the Google-managed cert provisions ~15-60 min after the DNS-auth CNAME"
  warn "resolves. Once ACTIVE it persists across every suspend/resume — resume never waits on it."

  echo
  log "Infra"
  echo "  Ingress IP: $(tf_out ingress_ip_address '—')"
  echo "  App domain: $(tf_out app_domain '—')"

  echo
  log "App health (deep — requires pod to be running)"
  local domain
  domain="$(tf_out app_domain)"
  if [[ -n "$domain" ]]; then
    curl -sf --max-time 5 "https://${domain}/api/health?deep=1" | jq . 2>/dev/null \
      || warn "health endpoint unreachable (cert provisioning or app not up yet)"
  else
    warn "app_domain not available — run 'apply' first"
  fi
}

# logs: tail the last 100 log lines from all devstash-web pods simultaneously.
# Prefixes each line with the pod name so interleaved output is attributable.
logs() {
  use_cluster_soft
  kubectl -n "$NS" logs -l app.kubernetes.io/name=devstash --tail=100 --prefix --ignore-errors 2>/dev/null || true
}
