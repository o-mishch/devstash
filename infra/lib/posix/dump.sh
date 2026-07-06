# shellcheck shell=sh
# PORTABLE POSIX-sh helpers for the Cloud SQL dump path — the ONE source of truth for the
# export → verify-non-empty → (delete-empty + retry) gate and the GCS version-prune, shared by
# BOTH runtimes that perform a suspend-time dump:
#
#   • bash  — infra/run/gcp/lib/db.sh (laptop `run.sh suspend`/`dump-db`), which sources this file.
#   • /bin/sh — infra/terraform/envs/dev/scripts/auto-suspend-dump.sh (Cloud Build step 3,
#               unattended auto-suspend), which `.`-sources this file AFTER step 2 (prepare)
#               git-cloned the repo into /workspace/repo.
#
# WHY POSIX sh (not bash): the Cloud Build step runs on cloud-sdk:slim under `#!/bin/sh`, so this
# shared file must be POSIX-portable. bash sources POSIX sh transparently, so db.sh loses nothing.
# This replaces the previous hand-mirrored copies the two files kept in sync via SIBLING comments.
#
# CRITICAL — EVERYTHING IS A PARAMETER, nothing is read from the ambient environment. In a Cloud
# Build `script` field, `$_VAR` substitutions are expanded by Cloud Build in the INLINE step body
# ONLY — a git-cloned, `.`-sourced file like this one is NOT substituted, so a `$_PROJECT_ID`
# reference here would be an empty shell var, not the substitution. The bash caller likewise uses
# different global names ($PROJECT_ID vs $_PROJECT_ID). So both callers map their own vars onto
# these positional args, and this file references only its `$1..$N`. (Same discipline the committed
# python3 helpers use — they take Cloud Build values via argv/env, never as in-file substitutions.)
#
# Source-guard: sourcing twice is a harmless no-op.
[ -n "${_DEVSTASH_POSIX_DUMP_SH:-}" ] && return 0
_DEVSTASH_POSIX_DUMP_SH=1

# ds_export_and_verify_dump <instance> <dump-uri> <database> <project>: server-side
# `gcloud sql export` of <database> on <instance> to <dump-uri>, then verify the object is
# non-empty — with ONE retry that first deletes an empty/partial object. `gcloud sql export` can
# leave a 0-byte object behind on a transient failure; re-exporting over it would then be verified
# against that stale empty object, so the retry removes it first. Returns 0 once a non-empty dump
# is confirmed and sets DS_DUMP_SIZE_BYTES to the verified size (a global — POSIX sh has no
# nameref); returns 1 if it still cannot after the retry. Progress lines go to STDERR so a caller
# may run this in a command substitution without capturing them; the only STDOUT is nothing (the
# size is returned via the global). The caller turns a non-zero return into its own data-safety
# abort (NEVER destroy an un-dumped instance).
ds_export_and_verify_dump() {
  _dsevd_instance="$1"; _dsevd_uri="$2"; _dsevd_db="$3"; _dsevd_project="$4"
  # export: the verified size is consumed by the sourcing caller (db.sh logs it), not here — mark it
  # used for shellcheck at the first assignment so the later real assignment needs no disable.
  export DS_DUMP_SIZE_BYTES=""
  _dsevd_attempt=1
  while [ "$_dsevd_attempt" -le 2 ]; do
    echo "Exporting Cloud SQL '$_dsevd_instance' -> $_dsevd_uri (server-side pg_dump, attempt $_dsevd_attempt/2)" >&2
    gcloud sql export sql "$_dsevd_instance" "$_dsevd_uri" \
      --database="$_dsevd_db" --project="$_dsevd_project" \
      || echo "gcloud sql export failed (attempt $_dsevd_attempt)" >&2
    _dsevd_size="$(gcloud storage objects describe "$_dsevd_uri" --format='value(size)' 2>/dev/null || true)"
    case "$_dsevd_size" in
      '' | *[!0-9]*) : ;;  # missing / non-numeric → fall through to delete + retry
      *)
        if [ "$_dsevd_size" -gt 0 ]; then
          DS_DUMP_SIZE_BYTES="$_dsevd_size"   # exported at first assignment above
          return 0
        fi
        ;;
    esac
    echo "dump $_dsevd_uri missing or empty (size='${_dsevd_size:-none}') — deleting partial object before retry" >&2
    gcloud storage rm "$_dsevd_uri" --quiet 2>/dev/null || true
    _dsevd_attempt=$((_dsevd_attempt + 1))
  done
  return 1
}

# ds_prune_dump_versions <gs-uri-prefix> <keep-total>: SYNCHRONOUSLY cap the object-version history
# at <gs-uri-prefix> to the <keep-total> most-recent generations, hard-deleting older noncurrent
# versions immediately (the complement to the bucket's async GCS lifecycle rule, which only runs on
# Google's ~daily schedule). Generation numbers increase monotonically, so a plain reverse sort on
# the `#<generation>` suffix is newest-first without parsing timestamps. Grouped PER object path
# (awk keying on the pre-`#` path) so a multi-object prefix keeps <keep-total> per object, not
# across a mixed listing — a strict superset of the single-object dump case. Best-effort and
# non-fatal throughout: a prune failure must NEVER abort the suspend that triggered it (the
# verified dump is already safe and the lifecycle rule backstops anything left behind).
ds_prune_dump_versions() {
  _dspv_prefix="$1"; _dspv_keep="$2"
  case "$_dspv_keep" in
    '' | *[!0-9]*) echo "ds_prune_dump_versions: invalid keep='$_dspv_keep' (need an integer >=1) — skipping" >&2; return 0 ;;
  esac
  [ "$_dspv_keep" -ge 1 ] || { echo "ds_prune_dump_versions: keep='$_dspv_keep' < 1 — skipping (would risk the live object)" >&2; return 0; }

  # -a includes noncurrent generations; the trailing ** matches every object under the prefix.
  _dspv_urls="$(gcloud storage ls -a "${_dspv_prefix}**" 2>/dev/null | grep '#[0-9]' | sort -r || true)"
  [ -n "$_dspv_urls" ] || return 0

  # Group by object path (strip the #generation) and keep the newest <keep-total> per path.
  _dspv_stale="$(printf '%s\n' "$_dspv_urls" | awk -F'#' -v keep="$_dspv_keep" '{ if (++seen[$1] > keep) print }')"
  [ -n "$_dspv_stale" ] || return 0

  echo "Pruning superseded dump version(s) at ${_dspv_prefix} (keeping newest $_dspv_keep per object)" >&2
  # Delete every stale generation in ONE gcloud invocation via -I (read #<generation> URLs from
  # stdin) rather than one `gcloud storage rm` per URL — a per-URL loop pays the ~1-2s gcloud/Python
  # startup + auth load N times, a single stdin-fed call loads auth once and deletes in parallel.
  # -c (continue-on-error) keeps the best-effort contract: a partial failure is non-fatal and the
  # bucket's lifecycle rule backstops anything left behind. Each URL is an explicit #<generation>,
  # so this can never touch the live object as long as <keep> >= 1.
  printf '%s\n' "$_dspv_stale" | gcloud storage rm -I -c --quiet 2>/dev/null \
    || echo "some dump versions could not be deleted at ${_dspv_prefix} (leaving for lifecycle backstop)" >&2
}
