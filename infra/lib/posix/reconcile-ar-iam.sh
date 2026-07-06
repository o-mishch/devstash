# shellcheck shell=sh
# PORTABLE POSIX-sh helper for purging STRANDED repo-scoped Artifact Registry IAM members from
# Terraform state — the ONE source of truth for the reconcile LOOP (the complement to the address
# DATA already single-sourced in infra/lib/ar-iam-member-addresses.txt). Shared by BOTH runtimes
# that run this reconcile before a deep-suspend apply:
#
#   • bash  — infra/run/gcp/lib/reconcile.sh branch 4 (laptop `run.sh apply`/`suspend`), which
#             sources this file.
#   • /bin/sh — infra/terraform/envs/dev/scripts/auto-suspend-suspend.sh (Cloud Build step 4,
#               unattended auto-suspend), which `.`-sources this file AFTER step 2 (prepare) git-
#               cloned the repo into /workspace/repo. This step runs under the OpenTofu image, so
#               `tofu` is on PATH exactly as this helper needs.
#
# WHY the stranding happens: the AR repo + its 3 repo-scoped IAM members are gated on
# environment_active (modules/artifact-registry, modules/iam), so a deep-suspend destroys them
# THROUGH Terraform (state count→0). A suspend that ran BEFORE the destroy-order fix (modules/iam
# artifact_registry_repository_depends_on) destroyed the repo FIRST, then 403'd removing the members
# via the now-vanished repo — leaving them in state pointing at a repo GCP no longer has. The next
# apply retries the same repo-scoped setIamPolicy and 403s AGAIN, re-wedging every apply/resume (and,
# unattended, firing the failure alert every tick with no way to recover). They cannot be destroyed
# through the API (no repo to setIamPolicy on), so purge them from state; resume recreates them
# (environment_active=true recreates the repo + members).
#
# SELF-DISABLING + SAFE: acts ONLY when the repo is genuinely ABSENT in GCP — the exact stranded
# signature. If the repo exists (a normal active env) the members are legitimately managed and are
# left untouched. Each `state rm` is guarded by an exact-address `state list` check (authoritative —
# no whole-list grep), so once purged, or on a clean env that was never stranded, this is a no-op.
#
# CRITICAL — EVERYTHING IS A PARAMETER (see infra/lib/posix/dump.sh + reap-negs.sh headers): a git-
# cloned, sourced file is NOT processed by Cloud Build $_VAR substitution, and the two callers use
# different global names ($REGION/$PROJECT_ID vs $_REGION/$_PROJECT_ID), so this file references only
# its positional args. It needs `tofu` on PATH — narrower than the cloud-sdk helpers, but both
# callers run it after `tofu init`.
#
# Source-guard: sourcing twice is a harmless no-op.
[ -n "${_DEVSTASH_POSIX_RECONCILE_AR_IAM_SH:-}" ] && return 0
_DEVSTASH_POSIX_RECONCILE_AR_IAM_SH=1

# ds_purge_stranded_ar_iam <repo-id> <region> <project> <addr-file>: if <repo-id> is ABSENT in GCP,
# `tofu state rm` each address in <addr-file> (skipping blank + `#`-comment lines) that is currently
# tracked in state. A present repo, or an already-clean state, is a no-op. Returns 0 on success; a
# failed `state rm` returns non-zero so the bash caller can escalate to `die` (the unattended sh
# caller runs under `set -e`, where the same non-zero aborts the step) — a stranded member that
# cannot be purged must not be silently swallowed, unlike the best-effort NEG/dump helpers.
ds_purge_stranded_ar_iam() {
  _psai_repo="$1"; _psai_region="$2"; _psai_project="$3"; _psai_file="$4"

  # Only the exact stranded signature: repo gone in GCP. Present repo → members legitimately managed.
  if gcloud artifacts repositories describe "$_psai_repo" \
       --location="$_psai_region" --project="$_psai_project" >/dev/null 2>&1; then
    return 0
  fi

  while IFS= read -r _psai_addr; do
    case "$_psai_addr" in '' | \#*) continue ;; esac
    # Exact-address state-list check (authoritative — no whole-list grep) so an unrelated line
    # can't fool it, and `state rm` is never called on an absent address (which would exit non-zero).
    if tofu state list "$_psai_addr" 2>/dev/null | grep -qxF "$_psai_addr"; then
      echo "Reconcile: repo '$_psai_repo' is gone but $_psai_addr is still in state (stranded by a pre-fix suspend) — removing from state so the next apply is not re-wedged by a 403" >&2
      tofu state rm -lock-timeout=120s "$_psai_addr" || return 1
    fi
  done < "$_psai_file"
}
