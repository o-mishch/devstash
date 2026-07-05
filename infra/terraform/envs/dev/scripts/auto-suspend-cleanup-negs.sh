#!/bin/sh
# Cloud Build step 7 — CLEANUP LEAKED NEGs (only if idle; see auto-suspend.tf). $_VAR values are
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
set -eu
[ -f /workspace/SUSPEND ] || { echo "not idle — skipping NEG cleanup"; exit 0; }

# 1 — Delete leaked zonal NEGs on our VPC. `list` returns name + zone basename; a NEG delete takes
# ONE name + its zone, so iterate. The --filter is server-side and scoped to $_VPC (self_link
# substring match via ':') so only our network's NEGs are ever listed. No matches → the loop body
# never runs → clean no-op. Read into a var first so a `list` hiccup doesn't abort under `set -e`.
echo "Reaping leaked GKE NEGs on $_VPC (orphaned by cluster teardown)"
NEGS="$(gcloud compute network-endpoint-groups list --project="$_PROJECT_ID" \
          --filter="network:$_VPC" --format='value(name,zone.basename())' 2>/dev/null || true)"
if [ -n "$NEGS" ]; then
  # Tab-separated name<TAB>zone per line. IFS split per line, then positional read of the two cols.
  echo "$NEGS" | while IFS='	' read -r NEG_NAME NEG_ZONE; do
    [ -n "$NEG_NAME" ] || continue
    echo "  deleting NEG $NEG_NAME ($NEG_ZONE)"
    gcloud compute network-endpoint-groups delete "$NEG_NAME" --zone="$NEG_ZONE" \
      --project="$_PROJECT_ID" --quiet \
      || echo "  NEG $NEG_NAME delete returned non-zero (already gone / in use) — continuing"
  done
else
  echo "no leaked NEGs on $_VPC — nothing to reap"
fi

# 2 — Delete stray GKE-created firewall rules on our VPC. GKE leaves these behind by the same
# controller-shutdown race; like NEGs they are harmless while suspended but block the VPC delete at
# `down`. Terraform does not manage them (GKE auto-creates them), so deleting them causes no state
# drift. Scoped to $_VPC AND the k8s- name prefix GKE uses, so only GKE's own auto-rules match —
# never a hand-authored or Terraform-managed rule.
echo "Reaping stray GKE firewall rules on $_VPC"
FW="$(gcloud compute firewall-rules list --project="$_PROJECT_ID" \
        --filter="network:$_VPC AND name:(gke-* OR k8s-*)" --format='value(name)' 2>/dev/null || true)"
if [ -n "$FW" ]; then
  echo "$FW" | while IFS= read -r FW_NAME; do
    [ -n "$FW_NAME" ] || continue
    echo "  deleting firewall rule $FW_NAME"
    gcloud compute firewall-rules delete "$FW_NAME" --project="$_PROJECT_ID" --quiet \
      || echo "  firewall $FW_NAME delete returned non-zero (already gone) — continuing"
  done
else
  echo "no stray GKE firewall rules on $_VPC — nothing to reap"
fi

echo "NEG/firewall cleanup complete — leaked GKE networking reaped so a future 'down' stays clean"
