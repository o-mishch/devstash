#!/usr/bin/env bats
# wait_for_cluster (run.sh): block until the GKE control plane answers kubectl, with three behaviours
# that are easy to break and costly to get wrong (see run.sh's header on the function):
#
#   1. FAST-FAIL PRE-GATE — a genuinely-absent cluster (empty `gcloud container clusters list`) dies
#      immediately, WITHOUT polling kubectl at all. That die is a real fault, so it must LEAVE the CI
#      cancel-trap intact (the build has nothing to deploy onto).
#   2. REACHABILITY TIMEOUT ≠ CI-CANCEL — when the cluster EXISTS but kubectl never answers within the
#      window, it CLEARS the EXIT cancel-trap (`trap - EXIT`) before dying, so a pre-dispatched deploy
#      is left running. This is the exact regression that turned a slow-but-healthy resume into a
#      cancelled deploy, so it is the highest-value assertion here.
#   3. TUNABLE CEILING — CLUSTER_REACHABLE_WAIT_ATTEMPTS/_GAP override the poll bound (default 90×10s).
#
# We source run.sh (its dispatch `case` is guarded by `BASH_SOURCE == $0`, so sourcing defines every
# function without running a command) and drive wait_for_cluster directly, stubbing its three
# collaborators — tofu_ (cluster-name output), gcloud (the `clusters list` inside ds_cluster_present),
# and kubectl (the reachability probe). PROJECT_ID/REGION are exported to mirror the post-ensure_tfvars
# state the function reads, exactly as bringup-gate.bats does.

setup() {
  load "${BATS_TEST_DIRNAME}/../../../lib/test_helper"
  export PROJECT_ID=proj REGION=us-central1 ENVIRONMENT=dev STATE_BUCKET=proj-tfstate-dev
  # Keep the reachability window tiny so the timeout tests finish fast — the tunable-ceiling behaviour
  # under test is itself what lets us do this. GAP=0 → no real sleeping between attempts.
  export CLUSTER_REACHABLE_WAIT_ATTEMPTS=3 CLUSTER_REACHABLE_WAIT_GAP=0
  # tofu_ is a run.sh function (not a command), so stub the underlying `tofu` binary it shells out to.
  # `output -raw gke_cluster_name` must echo the cluster name; any other output call echoes nothing.
  spy_cmd tofu 'case "$*" in *"output -raw gke_cluster_name"*) echo devstash-dev-gke ;; *) : ;; esac'
  source "$RUN_SH"
}

# ── 1. fast-fail pre-gate ───────────────────────────────────────────────────────────────────────

@test "wait_for_cluster: absent cluster (empty list) dies fast WITHOUT polling kubectl" {
  # gcloud container clusters list → empty means the cluster does not exist.
  spy_cmd gcloud ':'          # `list ... --format=value(name)` prints nothing → ds_cluster_present false
  spy_cmd kubectl ':'         # must never be called on the fast-fail path
  run wait_for_cluster
  assert_failure
  assert_output --partial "is not listable"
  assert_output --partial "real fault"
  # The whole point of the pre-gate: it short-circuits BEFORE the reachability poll.
  [ "$(spy_call_count kubectl)" -eq 0 ]
}

@test "wait_for_cluster: absent-cluster die LEAVES the CI cancel-trap intact (real fault → cancel CI)" {
  spy_cmd gcloud ':'
  spy_cmd kubectl ':'
  # Arm a sentinel EXIT trap standing in for _arm_ci_cancel_trap's, and assert wait_for_cluster does
  # NOT clear it on the absent-cluster path — a subshell so the trap fires on the subshell's exit.
  run bash -c '
    source "'"$RUN_SH"'"
    trap "echo TRAP_STILL_ARMED" EXIT
    wait_for_cluster
  '
  assert_failure
  assert_output --partial "TRAP_STILL_ARMED"
}

# ── 2. happy path ───────────────────────────────────────────────────────────────────────────────

@test "wait_for_cluster: reachable cluster succeeds on the first probe" {
  # present cluster: list echoes the name; kubectl cluster-info succeeds immediately.
  spy_cmd gcloud 'case "$*" in *"clusters list"*) echo devstash-dev-gke ;; *) : ;; esac'
  spy_cmd kubectl ':'         # `cluster-info` exits 0 → reachable
  run wait_for_cluster
  assert_success
  assert_output --partial "cluster reachable"
  [ "$(spy_call_count kubectl)" -eq 1 ]
}

# ── 3. reachability timeout ─────────────────────────────────────────────────────────────────────

@test "wait_for_cluster: existing-but-unreachable cluster times out after the tunable ceiling" {
  spy_cmd gcloud 'case "$*" in *"clusters list"*) echo devstash-dev-gke ;; *) : ;; esac'
  spy_cmd kubectl 'exit 1'    # cluster-info NEVER answers → exhaust the window
  run wait_for_cluster
  assert_failure
  assert_output --partial "not reachable after"
  assert_output --partial "LEFT RUNNING"
  # Ceiling honoured: exactly CLUSTER_REACHABLE_WAIT_ATTEMPTS (3) probes, no more.
  [ "$(spy_call_count kubectl)" -eq 3 ]
}

@test "wait_for_cluster: reachability timeout CLEARS the CI cancel-trap (leave the pre-dispatched deploy running)" {
  spy_cmd gcloud 'case "$*" in *"clusters list"*) echo devstash-dev-gke ;; *) : ;; esac'
  spy_cmd kubectl 'exit 1'
  # Same sentinel-trap technique as the pre-gate test, but here the timeout MUST clear it — so the
  # sentinel must NOT fire on exit. This is the regression guard: a healthy-but-slow resume must not
  # cancel its pre-dispatched CI run.
  run bash -c '
    export CLUSTER_REACHABLE_WAIT_ATTEMPTS=2 CLUSTER_REACHABLE_WAIT_GAP=0
    source "'"$RUN_SH"'"
    trap "echo TRAP_STILL_ARMED" EXIT
    wait_for_cluster
  '
  assert_failure
  assert_output --partial "not reachable after"
  refute_output --partial "TRAP_STILL_ARMED"
}

@test "wait_for_cluster: honours a raised CLUSTER_REACHABLE_WAIT_ATTEMPTS" {
  spy_cmd gcloud 'case "$*" in *"clusters list"*) echo devstash-dev-gke ;; *) : ;; esac'
  spy_cmd kubectl 'exit 1'
  CLUSTER_REACHABLE_WAIT_ATTEMPTS=5 CLUSTER_REACHABLE_WAIT_GAP=0 run wait_for_cluster
  assert_failure
  [ "$(spy_call_count kubectl)" -eq 5 ]
}
