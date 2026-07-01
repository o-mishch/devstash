#!/usr/bin/env bash
# Vulnerability severity gate (infra/docs/09-gcp-audit.md Increment 4). Runs before "Get
# GKE credentials" so a blocking finding fails fast, before touching the cluster.
# containeranalysis.googleapis.com is already enabled and the deployer SA already has
# roles/containeranalysis.occurrences.viewer (modules/iam/main.tf) — no new API/IAM setup.
#
# NOTE: the JSON field paths below (package_vulnerability_summary.vulnerabilities.*,
# extracting a CVE id from the note name) follow Google's documented schema for
# `gcloud artifacts docker images describe --show-package-vulnerability` but have not been
# exercised against a live scan result from this project. Verify on the first real deploy
# and adjust the jq paths if the actual output differs.
#
# Required env:
#   IMAGE_URI, WEB_DIGEST, MIGRATE_IMAGE  — from build-push.sh via $GITHUB_ENV
set -euo pipefail

# Artifact Analysis scanning is async — results may not exist immediately after push. Poll
# the documented readiness flag for up to 5 min per image. If still not ready by then, WARN
# and continue rather than block: this is a deliberate fail-open on SCANNER LATENCY, not on
# found vulnerabilities. Tighten to fail-closed once real-world scan latency is observed.
#
# Severity threshold: CRITICAL + HIGH only (MEDIUM/LOW are too noisy to gate CI on).
# Exceptions: infra/security/vulnerability-exceptions.yaml — unexpired entries matching this
# image's CVE are excluded from the gate.
check_image() {
  local artifact="$1" image_key="$2"
  local attempt=0 finished="false" result=""
  while (( attempt < 20 )); do
    result="$(gcloud artifacts docker images describe "$artifact" \
      --show-package-vulnerability --format=json 2>/dev/null || true)"
    finished="$(jq -r '.image_summary.vulnerability_initial_analysis_finished // false' \
      <<<"$result" 2>/dev/null || echo false)"
    if [[ "$finished" == "true" ]]; then
      break
    fi
    attempt=$((attempt + 1))
    sleep 15
  done
  if [[ "$finished" != "true" ]]; then
    echo "::warning::Vulnerability scan for ${artifact} not ready after 5 min — proceeding without blocking. Re-check manually: gcloud artifacts docker images describe ${artifact} --show-package-vulnerability"
    return 0
  fi
  local findings
  findings="$(jq -r '
    [(.package_vulnerability_summary.vulnerabilities.CRITICAL // []),
     (.package_vulnerability_summary.vulnerabilities.HIGH // [])]
    | flatten
    | .[]
    | (.vulnerability.shortDescription // .noteName // .vulnerability // "unknown") as $raw
    | ($raw | split("/") | last)
  ' <<<"$result" 2>/dev/null | sort -u || true)"
  local blocking=()
  while IFS= read -r cve; do
    if [[ -z "$cve" ]]; then
      continue
    fi
    if yq -e ".exceptions[] | select(.image == \"${image_key}\" and .cve == \"${cve}\" and .expires > \"$(date -u +%Y-%m-%d)\")" \
      infra/security/vulnerability-exceptions.yaml >/dev/null 2>&1; then
      echo "Exception on file for ${cve} (${image_key}) — skipping"
      continue
    fi
    blocking+=("$cve")
  done <<<"$findings"
  if (( ${#blocking[@]} > 0 )); then
    echo "::error::Unlisted CRITICAL/HIGH vulnerabilities in ${image_key} (${artifact}): ${blocking[*]}"
    echo "::error::Add a time-bound exception to infra/security/vulnerability-exceptions.yaml if this is accepted risk, or fix the underlying package."
    return 1
  fi
  echo "No unlisted CRITICAL/HIGH vulnerabilities in ${image_key}."
}

check_image "${IMAGE_URI}@${WEB_DIGEST}" web
check_image "${MIGRATE_IMAGE}" migrate
