#!/bin/sh
# Cloud Build step 6 — CLEANUP LEAKED NEGs (only if idle; see auto-suspend.tf). $_VAR values are
# Cloud Build substitutions mapped onto the step env — the `script` field doesn't expand them in
# content — so plain POSIX shell. Runs AFTER the tofu suspend, off the critical dump→destroy path,
# so a hiccup here never blocks the teardown.
#
# WHY — GKE's own teardown races itself: when a cluster is destroyed (our deep suspend does this
# via a Terraform count→0 apply every cycle), GKE frequently shuts down the NEG controller BEFORE
# it deletes the zonal Network Endpoint Groups the ingress created (one per Service-port per zone).
# Those NEGs are then orphaned — they hold no endpoints (size 0) but still reference the VPC. On
# suspend the VPC survives (it is ungated), so a leak here blocks nothing immediately; but the
# orphans ACCUMULATE across suspend/resume generations and, at the eventual `run.sh down`, every
# one of them pins the VPC delete ("network resource is already being used by …/networkEndpoint
# Groups/…"). Reaping them on each suspend keeps the count bounded so `down` stays clean. Ref: GKE
# docs, "standalone NEGs won't be deleted if the cluster deletion shuts down the NEG controller
# before it can delete the NEG." The lifecycle SA already holds roles/compute.networkAdmin
# (auto-suspend.tf), which covers networkEndpointGroups.delete + firewalls.delete — no extra grant.
#
# SCOPE — VPC-scoped, never name-guessed: only NEGs (and stray GKE firewall rules) whose network is
# OUR $_VPC are touched. The project's `default` network and any unrelated resource are invisible to
# the filters below, so this can't nuke anything shared. On THIS unattended path the cluster is
# already gone by this step (it runs AFTER the tofu suspend), so every NEG still on our VPC is by
# definition a leaked orphan (a live cluster would keep them). The `run.sh down` mirror runs before
# its destroy where the cluster may still be live — there an in-use delete just fails and is
# swallowed; see the note in lib/suspend.sh:cleanup_leaked_negs.
#
# Best-effort throughout: every failure is logged and swallowed — the env is already at ~$0, so a
# cleanup miss must never fail the suspend build.
#
# The reap loops are NOT reimplemented here anymore: they are the SHARED POSIX helper
# ds_reap_leaked_negs in infra/lib/posix/reap-negs.sh, the ONE source of truth this step and run.sh's
# cleanup_leaked_negs() (bash) both use. Step 2 (prepare) git-cloned the repo into /workspace/repo,
# so this step (6) `.`-sources the helper from there and passes $_VPC/$_PROJECT_ID as ARGUMENTS (a
# git-cloned file is not processed by Cloud Build $_VAR substitution — same discipline as the python3
# helpers). No VPC-existence guard here: this step runs AFTER the tofu suspend when the cluster is
# already gone, so every NEG still on our VPC is by definition a leaked orphan (the laptop `down`
# path guards because it can run while the cluster is still live — see suspend.sh).
set -eu
[ -f /workspace/SUSPEND ] || { echo "not idle — skipping NEG cleanup"; exit 0; }

# shellcheck source=infra/lib/posix/reap-negs.sh
. /workspace/repo/infra/lib/posix/reap-negs.sh

ds_reap_leaked_negs "$_VPC" "$_PROJECT_ID"

echo "NEG/firewall cleanup complete — leaked GKE networking reaped so a future 'down' stays clean"
