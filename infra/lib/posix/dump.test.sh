#!/usr/bin/env bash
# Self-contained, dependency-free test for the SHARED Cloud SQL dump helpers (dump.sh):
# ds_export_and_verify_dump + ds_prune_dump_versions. No bats/framework — same posture as
# secrets-guard.test.sh (the repo runs Vitest for app code only). Run directly:
#   bash infra/lib/posix/dump.test.sh
#
# Strategy: source dump.sh, then drive its two functions with `gcloud` STUBBED as a shell function
# whose behaviour is scripted per case. Covers the data-safety contract: export→verify→retry (the
# gate that must NEVER let a suspend destroy an un-dumped instance) and the per-object version prune.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
# shellcheck source=infra/lib/posix/dump.sh
source "$REPO_ROOT/infra/lib/posix/dump.sh"

PASS=0; FAIL=0
ok()  { printf '  \033[0;32m✓\033[0m %s\n' "$1"; PASS=$((PASS + 1)); }
bad() { printf '  \033[0;31m✗\033[0m %s\n' "$1"; FAIL=$((FAIL + 1)); }
# eq <label> <got> <want>: pass iff got == want.
eq() { if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (want '$3' got '$2')"; fi; }

# ── Stubbed gcloud. Behaviour is driven by files under $STUB. ────────────────
STUB=""
# Map an arbitrary gs:// URI to a flat, slash-free key file under $STUB.
objfile() { printf '%s/obj_%s' "$STUB" "$(printf '%s' "$1" | tr -c 'A-Za-z0-9' '_')"; }
gcloud() {
  case "$1 $2" in
    "sql export")
      # gcloud sql export sql <instance> <uri> --database=.. --project=..  → $5=uri
      local uri="$5" n sz
      n="$(cat "$STUB/attempt" 2>/dev/null || echo 0)"; n=$((n + 1)); echo "$n" > "$STUB/attempt"
      sz="$(sed -n "${n}p" "$STUB/sizes")"
      printf '%s' "$sz" > "$(objfile "$uri")"
      return 0 ;;
    "storage objects")
      # gcloud storage objects describe <uri> --format=value(size)  → $4=uri
      local f; f="$(objfile "$4")"
      [[ -s "$f" ]] && cat "$f"
      return 0 ;;
    "storage rm")
      # Two invocation forms:
      #   • single URI:  gcloud storage rm <uri> --quiet        (the export-retry delete-empty path)
      #   • stdin batch: printf '%s\n' <urls> | gcloud storage rm -I -c --quiet   (the prune path)
      # -I reads the #<generation> URLs from stdin instead of argv, so detect it and drain stdin,
      # logging each URL — otherwise `$3` is the `-c` flag, not a target.
      local _rm_arg _rm_stdin=""
      for _rm_arg in "$@"; do [[ "$_rm_arg" == "-I" ]] && _rm_stdin=1; done
      if [[ -n "$_rm_stdin" ]]; then
        local _rm_url
        while IFS= read -r _rm_url; do
          [[ -n "$_rm_url" ]] || continue
          rm -f "$(objfile "$_rm_url")" 2>/dev/null || true
          echo "$_rm_url" >> "$STUB/removed"
        done
      else
        rm -f "$(objfile "$3")" 2>/dev/null || true
        echo "$3" >> "$STUB/removed"
      fi
      return 0 ;;
    "storage ls")
      # gcloud storage ls -a <prefix>**  → emit the scripted generation listing
      cat "$STUB/listing" 2>/dev/null || true
      return 0 ;;
  esac
  return 0
}
new_stub() { STUB="$(mktemp -d)"; : > "$STUB/attempt"; : > "$STUB/removed"; }

echo "ds_export_and_verify_dump — data-safety gate:"

# (a) empty (0) then non-empty (2048) → verified, size captured, one delete of the empty object.
new_stub; printf '0\n2048\n' > "$STUB/sizes"
if ds_export_and_verify_dump inst gs://b/o.sql devstash proj >/dev/null 2>&1; then rc=0; else rc=1; fi
eq "retry-then-succeed returns 0"          "$rc" "0"
eq "verified size captured (bytes)"        "$DS_DUMP_SIZE_BYTES" "2048"
eq "empty object deleted before retry"     "$(grep -c 'gs://b/o.sql' "$STUB/removed")" "1"
rm -rf "$STUB"

# (b) always empty → non-zero ABORT, no size (suspend must NOT destroy an un-dumped instance).
new_stub; printf '0\n0\n' > "$STUB/sizes"
if ds_export_and_verify_dump inst gs://b/o.sql devstash proj >/dev/null 2>&1; then rc=0; else rc=1; fi
eq "always-empty returns non-zero (abort)" "$rc" "1"
eq "always-empty leaves size empty"        "${DS_DUMP_SIZE_BYTES:-EMPTY}" "EMPTY"
rm -rf "$STUB"

# (c) non-numeric size then good → tolerated, retried, correct size.
new_stub; printf 'garbage\n999\n' > "$STUB/sizes"
if ds_export_and_verify_dump inst gs://b/o.sql devstash proj >/dev/null 2>&1; then rc=0; else rc=1; fi
eq "non-numeric size tolerated, returns 0" "$rc" "0"
eq "size after non-numeric retry"          "$DS_DUMP_SIZE_BYTES" "999"
rm -rf "$STUB"

echo "ds_prune_dump_versions — per-object version cap:"

# (d) two objects; keep newest 2 per object → delete the single oldest of EACH.
new_stub
cat > "$STUB/listing" <<'EOF'
gs://b/default.tfstate#1700000000000005
gs://b/default.tfstate#1700000000000004
gs://b/default.tfstate#1700000000000003
gs://b/o.sql#1700000000000009
gs://b/o.sql#1700000000000008
gs://b/o.sql#1700000000000007
EOF
ds_prune_dump_versions gs://b/ 2 >/dev/null 2>&1
eq "prune deletes exactly 2 (one per object)" "$(grep -c '#' "$STUB/removed")" "2"
eq "prune drops oldest tfstate generation"    "$(grep -c 'default.tfstate#1700000000000003' "$STUB/removed")" "1"
eq "prune drops oldest o.sql generation"      "$(grep -c 'o.sql#1700000000000007' "$STUB/removed")" "1"
eq "prune keeps newest tfstate generation"    "$(grep -c 'default.tfstate#1700000000000005' "$STUB/removed")" "0"
rm -rf "$STUB"

# (e) keep=0 is refused — the guard must never risk the live object.
new_stub; printf 'gs://b/o.sql#1700000000000009\ngs://b/o.sql#1700000000000008\n' > "$STUB/listing"
ds_prune_dump_versions gs://b/ 0 >/dev/null 2>&1
eq "keep=0 deletes nothing (safety guard)"    "$(grep -c '#' "$STUB/removed" || true)" "0"
rm -rf "$STUB"

echo
if [[ $FAIL -eq 0 ]]; then
  printf '\033[0;32mALL %d PASSED\033[0m\n' "$PASS"; exit 0
fi
printf '\033[0;31m%d FAILED\033[0m, %d passed\n' "$FAIL" "$PASS"; exit 1
