#!/usr/bin/env bash
# Fallback full-history secret scan for `cleanup public` when gitleaks is not on PATH.
# Walks every commit reachable from all refs, runs secretlint against the diff
# introduced by that commit (added/modified lines only), and reports which
# commits contain a finding. This is slower and lower-recall than gitleaks'
# native history scanner but requires no extra binary beyond secretlint.
#
# Usage: scripts/scan-git-history.sh [repo-path]
# Requires: git, npx secretlint (installed as a devDependency), jq

set -euo pipefail

repo_path="${1:-.}"
cd "$repo_path"

if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required" >&2
  exit 1
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

commits="$(git log --all --pretty=format:%H --reverse)"
total=$(wc -l <<<"$commits" | tr -d ' ')
found=0
i=0

while IFS= read -r sha; do
  i=$((i + 1))
  changed_files="$(git show --pretty=format: --name-only --diff-filter=ACM "$sha" -- . | grep -v '^$' || true)"
  [ -z "$changed_files" ] && continue

  commit_dir="$tmp_dir/$sha"
  mkdir -p "$commit_dir"
  file_count=0

  while IFS= read -r f; do
    [ -z "$f" ] && continue
    out_path="$commit_dir/$f"
    mkdir -p "$(dirname "$out_path")"
    if git show "$sha:$f" >"$out_path" 2>/dev/null; then
      file_count=$((file_count + 1))
    fi
  done <<<"$changed_files"

  [ "$file_count" -eq 0 ] && continue

  if ! npx --yes secretlint --secretlintrc "$OLDPWD/.secretlintrc.json" "$commit_dir/**/*" --format json >"$tmp_dir/result-$sha.json" 2>/dev/null; then
    result_count=$(jq '[.[] | select(.messages | length > 0)] | length' "$tmp_dir/result-$sha.json" 2>/dev/null || echo 0)
    if [ "$result_count" -gt 0 ]; then
      found=$((found + 1))
      echo "FINDING commit=$sha"
      jq -r --arg sha "$sha" '.[] | select(.messages | length > 0) | .messages[] | "  \($sha) \(.ruleId // "secretlint"): \(.message)"' "$tmp_dir/result-$sha.json"
    fi
  fi

  rm -rf "$commit_dir"
done <<<"$commits"

echo "scanned $total commits, $found with findings" >&2
