# shellcheck shell=sh
# PORTABLE POSIX-sh helper for reaping the zonal Network Endpoint Groups (and stray GKE firewall
# rules) that GKE leaks when a cluster is destroyed — the ONE source of truth for the reap loops,
# shared by BOTH runtimes that perform this cleanup on a deep suspend:
#
#   • bash  — infra/run/gcp/lib/suspend.sh (laptop `run.sh suspend`/`down`), which sources this file.
#   • /bin/sh — infra/terraform/envs/dev/scripts/auto-suspend-cleanup-negs.sh (Cloud Build step 6,
#               unattended auto-suspend), which `.`-sources this file AFTER step 2 (prepare) git-
#               cloned the repo into /workspace/repo.
#
# WHY GKE leaks these: when a cluster is destroyed (our deep suspend does this via a Terraform
# count→0 apply every cycle), GKE frequently shuts down the NEG controller BEFORE it deletes the
# zonal NEGs the ingress created (one per Service-port per zone), and leaves stray gke-*/k8s-*
# firewall rules by the same race. On suspend the VPC survives, so a leak blocks nothing yet — but
# the orphans ACCUMULATE across suspend generations and eventually pin the VPC delete at `run.sh
# down`. Reaping them keeps the count bounded so `down` stays clean.
#
# SCOPE — VPC-scoped, never name-guessed: only NEGs/firewall rules whose network is the given <vpc>
# are touched (server-side --filter), so the project's `default` network and any unrelated resource
# are invisible. Best-effort throughout: every failure is logged and swallowed — the env is already
# at ~$0, so a cleanup miss must never fail the suspend.
#
# The VPC-EXISTENCE gate is NOT here — it is caller-specific: suspend.sh's `down` path can run this
# while the cluster (and an in-use NEG) is still live, so it guards on the VPC existing first; the
# Cloud Build step runs AFTER the tofu suspend when the cluster is already gone, so it needs no
# guard. Only the reap loops themselves are shared.
#
# CRITICAL — EVERYTHING IS A PARAMETER (see infra/lib/posix/dump.sh header): a git-cloned, sourced
# file is NOT processed by Cloud Build $_VAR substitution, and the two callers use different global
# names ($PROJECT_ID vs $_PROJECT_ID), so this file references only its positional args.
#
# Source-guard: sourcing twice is a harmless no-op.
[ -n "${_DEVSTASH_POSIX_REAP_NEGS_SH:-}" ] && return 0
_DEVSTASH_POSIX_REAP_NEGS_SH=1

# ds_reap_leaked_negs <vpc> <project>: delete every leaked zonal NEG and every stray gke-*/k8s-*
# firewall rule on <vpc>. `list` returns name + zone basename per NEG (a NEG delete takes one name +
# its zone, so iterate); firewall rules take just a name. No matches → the loop body never runs → a
# clean no-op. Each `list` is read into a var first so a transient `list` hiccup can't abort the
# caller under `set -e`, and each delete tolerates a non-zero exit (already gone / in use).
ds_reap_leaked_negs() {
  _drln_vpc="$1"; _drln_project="$2"

  echo "Reaping leaked GKE NEGs on $_drln_vpc (orphaned by cluster teardown)" >&2
  _drln_negs="$(gcloud compute network-endpoint-groups list --project="$_drln_project" \
    --filter="network:$_drln_vpc" --format='value(name,zone.basename())' 2>/dev/null || true)"
  if [ -n "$_drln_negs" ]; then
    printf '%s\n' "$_drln_negs" | while IFS='	' read -r _drln_name _drln_zone; do
      [ -n "$_drln_name" ] || continue
      echo "  deleting NEG $_drln_name ($_drln_zone)" >&2
      gcloud compute network-endpoint-groups delete "$_drln_name" --zone="$_drln_zone" \
        --project="$_drln_project" --quiet \
        || echo "  NEG $_drln_name delete returned non-zero (already gone / in use) — continuing" >&2
    done
  else
    echo "no leaked NEGs on $_drln_vpc — nothing to reap" >&2
  fi

  echo "Reaping stray GKE firewall rules on $_drln_vpc" >&2
  _drln_fw="$(gcloud compute firewall-rules list --project="$_drln_project" \
    --filter="network:$_drln_vpc AND name:(gke-* OR k8s-*)" --format='value(name)' 2>/dev/null || true)"
  if [ -n "$_drln_fw" ]; then
    printf '%s\n' "$_drln_fw" | while IFS= read -r _drln_fw_name; do
      [ -n "$_drln_fw_name" ] || continue
      echo "  deleting firewall rule $_drln_fw_name" >&2
      gcloud compute firewall-rules delete "$_drln_fw_name" --project="$_drln_project" --quiet \
        || echo "  firewall $_drln_fw_name delete returned non-zero (already gone) — continuing" >&2
    done
  else
    echo "no stray GKE firewall rules on $_drln_vpc — nothing to reap" >&2
  fi
}
