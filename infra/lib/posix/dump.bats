#!/usr/bin/env bats
# Shared Cloud SQL dump helpers (dump.sh): ds_export_and_verify_dump + ds_prune_dump_versions.
# Sources the POSIX-sh lib into bash and drives it with `gcloud` spied via spy_cmd (test_helper).
# Covers the data-safety contract: export→verify→retry (must NEVER let a suspend destroy an
# un-dumped instance) and the per-object version prune.
#
# The export retry is stateful (attempt 1 sees an empty object, attempt 2 a good one): the gcloud
# spy router serves `storage objects describe` from a per-attempt size list ($SIZES) advanced by a
# counter file. The prune deletes stale #generation URLs fed on STDIN (`gcloud storage rm -I`), so
# spy_capture_stdin + spy_stdin assert exactly which generations were pruned.

setup() {
  load "${BATS_TEST_DIRNAME}/../../run/gcp/lib/test_helper"
  # shellcheck source=infra/lib/posix/dump.sh
  source "${REPO_ROOT}/infra/lib/posix/dump.sh"
}

# ── ds_export_and_verify_dump — data-safety gate ─────────────────────────────────────────────
# Router: `sql export` succeeds; `storage objects describe` echoes the next size from $SIZES_FILE
# (one per line, consumed by an attempt counter); `storage rm` (delete-empty) just records.
_export_router='
  case "$1 $2" in
    "sql export")
      exit 0 ;;
    "storage objects")
      n=$(cat "$SPY_DIR/attempt" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$SPY_DIR/attempt"
      sed -n "${n}p" "$SPY_DIR/sizes" ;;
  esac
  exit 0'

_set_sizes() { printf '%s\n' "$@" > "${SPY_DIR:=${BATS_TEST_TMPDIR}/spy}/sizes"; mkdir -p "$SPY_DIR"; : > "$SPY_DIR/attempt"; }

@test "export: empty then non-empty → verified, size captured, one delete-empty before retry" {
  spy_cmd gcloud "$_export_router"; _set_sizes 0 2048
  ds_export_and_verify_dump inst gs://b/o.sql devstash proj
  assert_equal "$DS_DUMP_SIZE_BYTES" "2048"
  # The empty attempt-1 object is deleted before the retry (exactly once).
  assert_spy_called_with gcloud "storage" "rm" "gs://b/o.sql"
  assert_equal "$(grep -c $'\037rm' "$SPY_DIR/gcloud.calls")" "1"
}

@test "export: always-empty → non-zero ABORT, no size (never destroy an un-dumped instance)" {
  spy_cmd gcloud "$_export_router"; _set_sizes 0 0
  DS_DUMP_SIZE_BYTES="sentinel"
  run ds_export_and_verify_dump inst gs://b/o.sql devstash proj
  assert_failure
  # Re-run in this shell (run's subshell can't export the global back) to assert size stays empty.
  _set_sizes 0 0; DS_DUMP_SIZE_BYTES="sentinel"
  ds_export_and_verify_dump inst gs://b/o.sql devstash proj || true
  assert_equal "${DS_DUMP_SIZE_BYTES:-EMPTY}" "EMPTY"
}

@test "export: non-numeric size then good → tolerated, retried, correct size" {
  spy_cmd gcloud "$_export_router"; _set_sizes garbage 999
  ds_export_and_verify_dump inst gs://b/o.sql devstash proj
  assert_equal "$DS_DUMP_SIZE_BYTES" "999"
}

# ── ds_prune_dump_versions — per-object version cap ──────────────────────────────────────────
# Router: `storage ls -a` emits a mixed generation listing; `storage rm -I` reads the stale
# #generation URLs from STDIN (captured via spy_capture_stdin) so the test asserts exactly which
# generations were pruned.
_prune_router='
  case "$1 $2" in
    "storage ls") printf "gs://b/default.tfstate#1700000000000005\ngs://b/default.tfstate#1700000000000004\ngs://b/default.tfstate#1700000000000003\ngs://b/o.sql#1700000000000009\ngs://b/o.sql#1700000000000008\ngs://b/o.sql#1700000000000007\n" ;;
  esac
  exit 0'

@test "prune: keep newest 2 per object → deletes the single oldest of EACH object" {
  spy_cmd gcloud "$_prune_router"; spy_capture_stdin gcloud
  run ds_prune_dump_versions gs://b/ 2
  assert_success
  # The delete reads the stale generations on stdin — assert exactly the oldest of each object.
  run spy_stdin gcloud
  assert_line "gs://b/default.tfstate#1700000000000003"
  assert_line "gs://b/o.sql#1700000000000007"
  refute_line "gs://b/default.tfstate#1700000000000005"
  assert_equal "$(spy_stdin gcloud | grep -c '#')" "2"
}

@test "prune: keep=0 is refused → deletes nothing, gcloud never reached (safety guard)" {
  # keep < 1 returns BEFORE any ls/rm — the spy must record ZERO calls.
  spy_cmd gcloud 'exit 0'
  run ds_prune_dump_versions gs://b/ 0
  assert_success
  assert_equal "$(spy_call_count gcloud)" "0"
}
