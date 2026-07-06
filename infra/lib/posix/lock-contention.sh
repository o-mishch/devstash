# shellcheck shell=sh
# PORTABLE POSIX-sh helpers for the unattended auto-suspend build's OpenTofu STATE-LOCK contention
# handling — the ONE source of truth for the three-layer defence against two auto-suspend builds
# racing the same gke/dev tfstate lock. The failure this exists to stop: the alert AND the cron
# publish to one Pub/Sub topic (auto-suspend.tf), so two builds can start seconds apart; the guard's
# human-lock check (auto-suspend-guard.sh) can't catch it because the lock isn't ACQUIRED until the
# far-later suspend step, so both guards see a free lock, both proceed, and the second dies with
# "Error acquiring the state lock" after the first grabs it for a multi-minute GKE+SQL destroy.
#
# Sourced ONLY by the unattended auto-suspend steps (guard + suspend), never by the bash laptop path
# — run.sh already serialises the laptop side via wait_for_no_autosuspend_build. Both callers `.`-
# source this AFTER step 2 (prepare) git-cloned the repo into /workspace/repo, and both run under
# cloud-sdk:slim (gcloud + python3 on PATH); ds_force_unlock_if_dead additionally needs `tofu`, but
# it is only ever called from the suspend step, which runs under the OpenTofu image.
#
# CRITICAL — EVERYTHING IS A PARAMETER (see infra/lib/posix/reap-negs.sh + reconcile-ar-iam.sh
# headers): a git-cloned, sourced file is NOT processed by Cloud Build $_VAR substitution, and the
# callers reference these globals through their $_-prefixed substitution names, so this file takes
# only positional args and reads no globals.
#
# Source-guard: sourcing twice is a harmless no-op.
[ -n "${_DEVSTASH_POSIX_LOCK_CONTENTION_SH:-}" ] && return 0
_DEVSTASH_POSIX_LOCK_CONTENTION_SH=1

# ds_older_autosuspend_build_running <region> <project> <trigger-name> <self-build-id>: exit 0 (true)
# iff some OTHER ongoing (QUEUED/WORKING) auto-suspend build for this env was created BEFORE this one
# — i.e. a build that will win the state lock first, so THIS build should defer. Deterministic
# tiebreak by createTime (the real lock-acquisition order): the single earliest build proceeds, every
# later one no-ops, so overlapping alert+cron fires collapse to one suspend instead of racing the lock.
#
# Match by the trigger's NAME (passed in — Cloud Build's built-in TRIGGER_NAME substitution) — the
# SAME contract run.sh's _ongoing_autosuspend_build_ids uses, stable across trigger replaces (unlike
# buildTriggerId). The self build is excluded by id so this never counts itself. A transient `list`
# error yields no rows → exit 1 (false, don't defer): failing OPEN is correct here, because the
# layer-2 lock-timeout and layer-3 force-unlock behind this still protect a build that wrongly
# proceeds; failing closed could silently skip a legitimately-needed suspend on a flaky API call.
ds_older_autosuspend_build_running() {
  _oabr_region="$1"; _oabr_project="$2"; _oabr_trigger="$3"; _oabr_self="$4"

  # createTime of THIS build — the tiebreak boundary. If the self lookup fails (transient), treat the
  # boundary as empty and fall through to "no older build" (exit 1): same fail-open rationale as above.
  _oabr_self_created="$(gcloud builds describe "$_oabr_self" \
    --region="$_oabr_region" --project="$_oabr_project" \
    --format='value(createTime)' 2>/dev/null || true)"
  [ -n "$_oabr_self_created" ] || return 1

  # Ongoing auto-suspend builds as "id<TAB>createTime" rows, self excluded. --filter is server-side;
  # the TRIGGER_NAME match is the shared "our auto-suspend build" contract. Read into a var (not piped
  # straight into a loop) so a `list` hiccup can't abort the caller under `set -e`.
  _oabr_rows="$(gcloud builds list --region="$_oabr_region" --project="$_oabr_project" --ongoing \
    --filter="substitutions.TRIGGER_NAME=$_oabr_trigger AND id!=$_oabr_self" \
    --format='value(id,createTime)' 2>/dev/null || true)"
  [ -n "$_oabr_rows" ] || return 1

  # A row is an "older sibling" iff its createTime is chronologically before ours. POSIX sh's `[ ]`
  # has no defined string-ordering operator (`<` is undefined), so ordering is decided with `sort`:
  # two fixed-width RFC-3339 UTC (…Z) stamps from the same API, fed through `sort`, put the earlier
  # one first — so a sibling is older iff `sort` ranks its stamp first AND the two stamps differ.
  # A plain `while read` here is the exception the coding standard allows: the body needs per-row
  # work and POSIX sh has no array-method equivalent. The `echo | while` runs in a pipe subshell, so
  # its exit status IS this function's return value — `exit 0` on the first older sibling (defer),
  # and a clean fall-through leaves the subshell's status non-zero (proceed). No trailing command
  # may follow the pipe, or it would clobber that status.
  echo "$_oabr_rows" | while IFS='	' read -r _oabr_id _oabr_created; do
    [ -n "$_oabr_created" ] || continue
    _oabr_first="$(printf '%s\n%s\n' "$_oabr_created" "$_oabr_self_created" | sort | head -n1)"
    if [ "$_oabr_first" = "$_oabr_created" ] && [ "$_oabr_created" != "$_oabr_self_created" ]; then
      echo "another auto-suspend build ($_oabr_id) started at $_oabr_created, before this one ($_oabr_self_created) — deferring to it" >&2
      exit 0
    fi
    false   # keep the subshell's status non-zero as we fall through, so "no older sibling" ⇒ proceed
  done
}

# ds_force_unlock_if_dead <region> <project> <state-bucket> <trigger-name> <self-build-id> <lock-id-py>:
# the layer-3 recovery. Called after a `tofu apply` has ALREADY failed to acquire the lock even past
# the long -lock-timeout. Reads the live lock object, decides whether its holder is still alive, and
# force-unlocks + returns 0 (retry) ONLY when NO auto-suspend build other than us is still ongoing —
# i.e. the lock is orphaned (a build crashed mid-apply without releasing it). If a sibling is still
# QUEUED/WORKING the lock is LEGITIMATELY held by a live destroy — return 1 (do NOT unlock; the caller
# exits 0 as a benign no-op and the next tick retries). Never breaks a live apply — the one hard
# safety rule of force-unlock.
#
# The lock object lives at the fixed backend prefix gke/dev (backend.tf) in <state-bucket>. Its JSON
# "ID" field is the value `tofu force-unlock` needs; the <lock-id-py> helper
# (auto-suspend-lock-id.py) extracts it so no JSON parsing is inlined into this shell — same language
# segregation as the guard/idle-count Python. "Who" (root@<hostname>) can't be mapped to a build id
# (Cloud Build hostnames aren't the build id), so aliveness is decided by the sibling-build check
# above, the SAME conservative signal the guard dedup uses.
ds_force_unlock_if_dead() {
  _ful_region="$1"; _ful_project="$2"; _ful_bucket="$3"
  _ful_trigger="$4"; _ful_self="$5"; _ful_lock_id_py="$6"
  _ful_lock="gs://$_ful_bucket/gke/dev/default.tflock"

  # No lock object → it was released between the apply failure and now; nothing to break. Signal
  # "retry" so the caller re-attempts the apply (the contention has cleared on its own).
  _ful_json="$(gcloud storage cat "$_ful_lock" --project="$_ful_project" 2>/dev/null || true)"
  if [ -z "$_ful_json" ]; then
    echo "state lock is already gone — the holder released it; retrying the apply" >&2
    return 0
  fi

  # Is ANY other auto-suspend build still ongoing? If so the lock is live — do NOT break it.
  _ful_others="$(gcloud builds list --region="$_ful_region" --project="$_ful_project" --ongoing \
    --filter="substitutions.TRIGGER_NAME=$_ful_trigger AND id!=$_ful_self" \
    --format='value(id)' 2>/dev/null || true)"
  if [ -n "$_ful_others" ]; then
    echo "state lock is held by a live auto-suspend build (${_ful_others}) mid-destroy — NOT force-unlocking; the sibling completes the suspend and this build is a no-op" >&2
    return 1
  fi

  # No sibling build is ongoing, yet the lock persists → it is orphaned (a build crashed mid-apply
  # without releasing it). Break it and signal retry. The env is at risk of staying up-billing until
  # the lock clears, so recovering here is the win.
  #
  # CRITICAL — force-unlock by the GCS OBJECT GENERATION, not the .tflock JSON "ID". For the gcs
  # backend `tofu force-unlock` takes the numeric object generation (the value tofu prints as `ID:`
  # in its acquire-error box); the JSON "ID" is an internal UUID that GCS rejects with "Lock ID
  # should be numerical value" — silently leaving an orphaned lock in place (a real incident). We
  # still parse the JSON ID first, purely as a guard that the object is a well-formed lock (not a
  # truncated/foreign blob) before we break it, then unlock by the generation.
  _ful_uuid="$(echo "$_ful_json" | python3 "$_ful_lock_id_py" 2>/dev/null || true)"
  if [ -z "$_ful_uuid" ]; then
    echo "could not parse the lock ID from $_ful_lock — refusing to force-unlock blind" >&2
    return 1
  fi
  _ful_gen="$(gcloud storage objects describe "$_ful_lock" --project="$_ful_project" \
    --format='value(generation)' 2>/dev/null || true)"
  if [ -z "$_ful_gen" ]; then
    echo "could not read the generation of $_ful_lock — refusing to force-unlock blind" >&2
    return 1
  fi
  echo "state lock (id $_ful_uuid, generation $_ful_gen) is orphaned (no auto-suspend build is running) — force-unlocking and retrying" >&2
  tofu force-unlock -force "$_ful_gen"
}
