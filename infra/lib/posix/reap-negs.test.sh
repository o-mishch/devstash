#!/usr/bin/env bash
# Self-contained, dependency-free test for the SHARED GKE-leak reap helper (reap-negs.sh):
# ds_reap_leaked_negs. No bats/framework — same posture as secrets-guard.test.sh. Run directly:
#   bash infra/lib/posix/reap-negs.test.sh
#
# Strategy: source reap-negs.sh, stub `gcloud` as a shell function that serves scripted list output
# and logs every delete. Asserts the VPC-scoped reap deletes each leaked NEG with its correct zone
# and each stray gke-*/k8s-* firewall rule — the tab-split list→delete loop is the easy-to-break part.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
# shellcheck source=infra/lib/posix/reap-negs.sh
source "$REPO_ROOT/infra/lib/posix/reap-negs.sh"

PASS=0; FAIL=0
ok()  { printf '  \033[0;32m✓\033[0m %s\n' "$1"; PASS=$((PASS + 1)); }
bad() { printf '  \033[0;31m✗\033[0m %s\n' "$1"; FAIL=$((FAIL + 1)); }
eq() { if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (want '$3' got '$2')"; fi; }

STUB=""
# gcloud stub: NEG list emits tab-separated name<TAB>zone; firewall list emits names; each delete is
# logged. Behaviour is fixed (not file-driven) — one representative leaked topology is enough.
gcloud() {
  case "$2 $3" in
    "network-endpoint-groups list") printf 'neg-a\tus-central1-a\nneg-b\tus-central1-b\n' ;;
    "network-endpoint-groups delete")
      local name="$4" zone="" a
      for a in "$@"; do case "$a" in --zone=*) zone="${a#--zone=}" ;; esac; done
      echo "NEG:$name:$zone" >> "$STUB/deleted" ;;
    "firewall-rules list") printf 'gke-abc-node\nk8s-def-fw\n' ;;
    "firewall-rules delete") echo "FW:$4" >> "$STUB/deleted" ;;
  esac
  return 0
}

echo "ds_reap_leaked_negs — VPC-scoped NEG + firewall reap:"
STUB="$(mktemp -d)"; : > "$STUB/deleted"
ds_reap_leaked_negs devstash-dev-vpc my-project >/dev/null 2>&1
eq "deletes neg-a with its zone"     "$(grep -c 'NEG:neg-a:us-central1-a' "$STUB/deleted")" "1"
eq "deletes neg-b with its zone"     "$(grep -c 'NEG:neg-b:us-central1-b' "$STUB/deleted")" "1"
eq "deletes the gke-* firewall rule" "$(grep -c 'FW:gke-abc-node' "$STUB/deleted")" "1"
eq "deletes the k8s-* firewall rule" "$(grep -c 'FW:k8s-def-fw' "$STUB/deleted")" "1"
eq "exactly four deletes total"      "$(grep -c ':' "$STUB/deleted")" "4"
rm -rf "$STUB"

# Empty listings → clean no-op (no deletes, no error under set -e).
gcloud() { return 0; }   # every list returns nothing
echo "ds_reap_leaked_negs — nothing leaked:"
STUB="$(mktemp -d)"; : > "$STUB/deleted"
if ds_reap_leaked_negs devstash-dev-vpc my-project >/dev/null 2>&1; then rc=0; else rc=1; fi
eq "no-leaks path returns 0"         "$rc" "0"
eq "no-leaks path deletes nothing"   "$(grep -c ':' "$STUB/deleted" || true)" "0"
rm -rf "$STUB"

echo
if [[ $FAIL -eq 0 ]]; then
  printf '\033[0;32mALL %d PASSED\033[0m\n' "$PASS"; exit 0
fi
printf '\033[0;31m%d FAILED\033[0m, %d passed\n' "$FAIL" "$PASS"; exit 1
