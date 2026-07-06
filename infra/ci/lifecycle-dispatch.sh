#!/usr/bin/env bash
# On-demand suspend / resume dispatcher for the GitHub-Actions button
# (.github/workflows/infra-lifecycle.yml → this script). Runnable locally the same way:
#   ACTION=resume bash infra/ci/lifecycle-dispatch.sh
#
# This is a THIN wrapper, deliberately: it does NOT reimplement any suspend/resume logic.
# infra/run/gcp/run.sh is already the full orchestrator (dump → apply → restore → deploy →
# DNS), and it is non-interactive once AUTO_APPROVE=1 removes its only human gate (the
# `confirm` before `tofu apply`/`destroy`, see infra/lib/common.sh). So the runner just sets
# that flag and calls `run.sh <resume|suspend>` — the manual button and a local
# `bash infra/run/gcp/run.sh resume` take the IDENTICAL code path, which is the whole point:
# no forked headless variant to drift from the real one.
#
# Preconditions the workflow guarantees (documented here so a local run matches):
#   • CWD is the repo root (run.sh resolves its libs by relative path).
#   • gcloud is authenticated as the lifecycle-deployer SA (WIF) with ADC available, so
#     run.sh's apply/dump/restore reach GCP. Spaceship DNS creds are read from Secret
#     Manager by that same identity — no env var needed.
#   • GH_TOKEN is a fine-grained PAT (Secrets=write, Actions=write): run.sh's secrets()
#     does `gh secret set …` and deploy dispatches deploy-gke.yml. The default GITHUB_TOKEN
#     cannot write secrets, so the workflow injects the PAT as GH_TOKEN.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

# ACTION comes from the workflow_dispatch `action` input (mapped to $ACTION), or arg 1 for a
# local run. Whitelist it explicitly — this string is passed straight to run.sh, and only
# these two lifecycle verbs are valid here (deploy/apply/down are their own separate paths).
ACTION="${ACTION:-${1:-}}"
case "$ACTION" in
  resume | suspend) ;;
  *)
    echo "lifecycle-dispatch: ACTION must be 'resume' or 'suspend' (got '${ACTION:-<empty>}')" >&2
    exit 2
    ;;
esac

# Fail fast with an actionable message if the PAT is absent — otherwise run.sh would get deep
# into an apply and only then die inside secrets()/deploy on the first `gh` write, wasting a
# long provision. gh auth status confirms the token actually authenticates, not just that the
# var is set.
[[ -n "${GH_TOKEN:-}" ]] || { echo "lifecycle-dispatch: GH_TOKEN is not set (needs the fine-grained PAT)" >&2; exit 2; }
gh auth status >/dev/null 2>&1 || { echo "lifecycle-dispatch: gh is not authenticated — check the LIFECYCLE_GH_TOKEN secret" >&2; exit 2; }

# AUTO_APPROVE=1 skips run.sh's interactive `confirm` before tofu apply/destroy (common.sh) —
# the ONLY thing that would otherwise block this on a runner. Everything else in run.sh is
# already non-interactive.
export AUTO_APPROVE=1

echo "lifecycle-dispatch: running 'run.sh $ACTION' (AUTO_APPROVE=1)"
exec bash infra/run/gcp/run.sh "$ACTION"
