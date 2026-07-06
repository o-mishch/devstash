#!/usr/bin/env bats
# restore_db (db.sh): the resume-time GCS-dump import, and the guard that stops it overwriting a
# database that is ALREADY LIVE. `resume` is invoked with a boolean snapshot (taken by
# suspend.sh's _apply_and_wire_cluster_overlapped BEFORE apply runs) of whether the Cloud SQL
# instance was already describable — i.e. this resume is being re-run against an env that was
# never actually suspended, or a prior resume already brought it up. In that case the instance
# holds real data written since the LAST genuine suspend, which is newer than the GCS dump by
# construction (dump_db only ever runs from suspend()). CONFIRMED LIVE 2026-07-06: two `resume`
# calls run back to back silently overwrote a signed-in user's items each time, because restore_db
# unconditionally dropped + reimported the stale dump over an already-live database. This file
# guards that regression and the ordinary "no dump yet" / genuine-restore paths around it.
#
# We source run.sh (its dispatch `case` is guarded by `BASH_SOURCE == $0`), which pulls in
# lib/db.sh (restore_db, resolve_dump_target, _sql_instance_exists) and lib/suspend.sh
# transitively — same pattern as wait-for-cluster.bats / bringup-gate.bats.

setup() {
  load "${BATS_TEST_DIRNAME}/../../../lib/test_helper"
  export PROJECT_ID=proj REGION=us-central1 ENVIRONMENT=dev STATE_BUCKET=proj-tfstate-dev DB_NAME=devstash
  # resolve_dump_target reads three tofu outputs via tf_out (which shells to `tofu output -json`).
  spy_cmd tofu 'case "$*" in
    *"output -json"*) echo "{\"db_instance_name\":{\"value\":\"devstash-dev-sql\"},\"db_dumps_bucket\":{\"value\":\"proj-dumps\"},\"db_dump_object\":{\"value\":\"devstash-latest.sql\"}}" ;;
    *) : ;;
  esac'
  source "$RUN_SH"
}

# ── the regression guard ────────────────────────────────────────────────────────────────────────

@test "restore_db: was-already-live=true SKIPS the import entirely (does not touch gcloud sql)" {
  spy_cmd gcloud ':'   # must never be called for databases delete/create/import on this path
  run restore_db true
  assert_success
  assert_output --partial "already existed before this resume's apply ran"
  assert_output --partial "Skipping restore"
  [ "$(spy_call_count gcloud)" -eq 0 ]
}

@test "restore_db: was-already-live=true never calls gcloud storage objects describe either" {
  # The already-live guard must short-circuit BEFORE even checking for a dump object — an
  # already-live instance needs no restore decision made from the dump's presence at all.
  spy_cmd gcloud 'echo "should not be reached" >&2; exit 1'
  run restore_db true
  assert_success
  refute_output --partial "should not be reached"
}

# ── genuine restore (default / was-already-live=false) ─────────────────────────────────────────

@test "restore_db: defaults to false when called with no argument (back-compat)" {
  spy_cmd gcloud 'case "$*" in
    *"storage objects describe"*) exit 1 ;;  # no dump present
    *) : ;;
  esac'
  run restore_db
  assert_success
  assert_output --partial "no dump at"
  assert_output --partial "fresh database"
}

@test "restore_db: no dump object present → skips (fresh database, let migrations create schema)" {
  spy_cmd gcloud 'case "$*" in
    *"storage objects describe"*) exit 1 ;;
    *) : ;;
  esac'
  run restore_db false
  assert_success
  assert_output --partial "no dump at"
  refute_output --partial "Resetting database"
}

@test "restore_db: genuine restore drops, recreates, then imports the dump" {
  spy_cmd gcloud 'case "$*" in
    *"storage objects describe"*) exit 0 ;;
    *) : ;;
  esac'
  run restore_db false
  assert_success
  assert_output --partial "Resetting database"
  assert_output --partial "Importing"
  assert_output --partial "DB restored from"
  assert_spy_called_with gcloud sql databases delete devstash
  assert_spy_called_with gcloud sql databases create devstash
  assert_spy_called_with gcloud sql import sql devstash-dev-sql
}

@test "restore_db: genuine restore still proceeds when the database did not exist yet (fresh instance)" {
  spy_cmd gcloud 'case "$*" in
    *"storage objects describe"*) exit 0 ;;
    *"sql databases delete"*) exit 1 ;;   # did not exist — the warn-and-continue branch
    *) : ;;
  esac'
  run restore_db false
  assert_success
  assert_output --partial "did not exist"
  assert_output --partial "DB restored from"
}

@test "restore_db: import failure dies with the retry-safe hint" {
  spy_cmd gcloud 'case "$*" in
    *"storage objects describe"*) exit 0 ;;
    *"sql import sql"*) exit 1 ;;
    *) : ;;
  esac'
  run restore_db false
  assert_failure
  assert_output --partial "gcloud sql import failed"
  assert_output --partial "restore is now retry-safe"
}

@test "restore_db: unresolvable dump target (missing tofu outputs) skips without dying" {
  spy_cmd tofu 'echo "{}"'   # every output empty → resolve_dump_target fails
  spy_cmd gcloud ':'
  run restore_db false
  assert_success
  assert_output --partial "no instance / dump bucket / object resolved"
  [ "$(spy_call_count gcloud)" -eq 0 ]
}

# ── _sql_instance_exists (the pre-apply snapshot probe) ─────────────────────────────────────────

@test "_sql_instance_exists: true when gcloud sql instances describe succeeds" {
  spy_cmd gcloud 'exit 0'
  run _sql_instance_exists devstash-dev-sql
  assert_success
}

@test "_sql_instance_exists: false when gcloud sql instances describe fails (instance absent)" {
  spy_cmd gcloud 'exit 1'
  run _sql_instance_exists devstash-dev-sql
  assert_failure
}
