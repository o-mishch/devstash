#!/usr/bin/env bats
# Shared GKE-leak reap helper (reap-negs.sh): ds_reap_leaked_negs. Sources the POSIX-sh lib into
# bash and drives it with `gcloud` spied via spy_cmd (test_helper). The VPC-scoped reap must delete
# each leaked zonal NEG with its correct zone and each stray gke-*/k8s-* firewall rule — so the test
# asserts the DYNAMIC per-delete args (which name + which zone), which spy_cmd records and
# assert_spy_called_with matches.

setup() {
  load "${BATS_TEST_DIRNAME}/../../run/gcp/lib/test_helper"
  # shellcheck source=infra/lib/posix/reap-negs.sh
  source "${REPO_ROOT}/infra/lib/posix/reap-negs.sh"
}

# gcloud spy router: list emits tab-separated rows the reap loops parse; deletes just record + succeed.
_reap_gcloud_router='
  case "$2 $3" in
    "network-endpoint-groups list") printf "neg-a\tus-central1-a\nneg-b\tus-central1-b\n" ;;
    "firewall-rules list")          printf "gke-abc-node\nk8s-def-fw\n" ;;
  esac
  exit 0'

@test "reap: deletes each leaked NEG with its zone and each stray firewall rule" {
  spy_cmd gcloud "$_reap_gcloud_router"
  run ds_reap_leaked_negs devstash-dev-vpc my-project
  assert_success
  # Dynamic per-delete args: each NEG deleted WITH its correct zone, each firewall rule by name.
  assert_spy_called_with gcloud "network-endpoint-groups" "delete" "neg-a" "--zone=us-central1-a"
  assert_spy_called_with gcloud "network-endpoint-groups" "delete" "neg-b" "--zone=us-central1-b"
  assert_spy_called_with gcloud "firewall-rules" "delete" "gke-abc-node"
  assert_spy_called_with gcloud "firewall-rules" "delete" "k8s-def-fw"
  # Exactly 4 deletes + 2 lists = 6 calls (no stray deletes).
  assert_equal "$(spy_call_count gcloud)" "6"
}

@test "reap: nothing leaked → clean no-op, no deletes" {
  spy_cmd gcloud 'exit 0'   # every list returns empty
  run ds_reap_leaked_negs devstash-dev-vpc my-project
  assert_success
  refute_spy_called_with gcloud "delete"
}
