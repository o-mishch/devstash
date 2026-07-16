#!/usr/bin/env bash
# Resolve the changeset and the exact rule files a cleanup run must read.
#
# Why this is a script and not a table in SKILL.md: the mapping from changed
# paths to rule files already exists, authoritatively, in each rule file's own
# `paths:` frontmatter. A second copy in SKILL.md costs ~1.2k tokens on every
# run and drifts from the source (it did: legacy-ops.md's table row claimed
# src/**/* while the rule file itself globs package.json/.env*/prisma/**/*).
# Deriving it here keeps one source of truth and costs no context — only this
# script's output is read, never its source.
#
# Usage: resolve-context.sh <check|run|improve|public>
#
# The functions below are sourced by globcheck.sh; keep them side-effect free.

set -euo pipefail

# glob -> ERE. Order matters: `**/` becomes an optional path prefix so that
# src/**/*.ts matches src/a.ts as well as src/a/b/c.ts.
glob_to_ere() {
	printf '%s' "$1" |
		sed -e 's/[.]/\\./g' \
			-e 's#\*\*/#\x01#g' \
			-e 's/\*\*/\x02/g' \
			-e 's/\*/[^\/]*/g' \
			-e 's#\x01#(.*/)?#g' \
			-e 's/\x02/.*/g'
}

# `paths:` is the authoritative field: it is the only one Claude Code scopes on,
# and its presence is what makes a rule path-scoped rather than load-at-launch.
# `trigger:`/`globs:` are Antigravity's, inferred and unverified (see CLAUDE.md's
# maintainer notes), so they are cross-checked but never keyed on — a rule with
# paths: and a typo'd trigger: must still resolve correctly here.
rule_globs() {
	awk '
		NR==1&&/^---/{f=1;next} f&&/^---/{exit}
		f&&/^paths:/{p=1;next}
		p&&/^[a-z_]+:/{p=0}
		p&&/^[[:space:]]*-[[:space:]]/{gsub(/^[[:space:]]*-[[:space:]]*/,"");gsub(/"/,"");print}
	' "$1"
}

rule_trigger() {
	awk 'NR==1&&/^---/{f=1;next} f&&/^---/{exit} f&&/^trigger:/{print $2;exit}' "$1"
}

# Does any changed path match any of this rule's globs?
rule_matches() {
	local rf="$1" g ere c
	shift
	while IFS= read -r g; do
		[ -n "$g" ] || continue
		ere="^$(glob_to_ere "$g")$"
		for c in "$@"; do
			printf '%s' "$c" | grep -Eq "$ere" && return 0
		done
	done < <(rule_globs "$rf")
	return 1
}

main() {
	local mode="${1:-}"
	case "$mode" in
	check | run | improve | public) ;;
	*)
		# Never exit non-zero: SKILL.md injects this via !`...`, and a failing
		# injected command yields EMPTY skill output — the usage table would
		# never render and /cleanup would silently do nothing. Report the
		# problem on stdout instead and let SKILL.md handle it.
		echo "## No mode"
		if [ -z "$mode" ]; then
			echo "No mode supplied. Show the Usage table and stop."
		else
			echo "Unrecognized mode '$mode'. Show the Usage table and stop."
		fi
		return 0
		;;
	esac

	local repo_root
	repo_root="$(git rev-parse --show-toplevel)"
	cd "$repo_root"
	local rules_dir=".agents/rules"

	# --- changeset -----------------------------------------------------------
	local changed
	mapfile -t changed < <(git status --porcelain | sed 's/^...//' | sed 's/.* -> //' | sort -u)

	echo "## Changeset (${#changed[@]} files)"
	if [ "${#changed[@]}" -eq 0 ]; then
		echo "(none — no uncommitted work)"
		echo
		echo "## Rule files to read"
		echo "(none)"
		return 0
	fi
	printf '%s\n' "${changed[@]}"
	echo

	# --- LOC (improve only; the report's At-a-glance needs it) ---------------
	if [ "$mode" = improve ]; then
		echo "## LOC changed"
		git diff --shortstat HEAD || true
		# Count untracked lines file-by-file. `git ls-files --others` also emits
		# untracked *symlinks* (e.g. .claude/agents -> ../.agents/agents), and a
		# `xargs wc -l` over those dies with "Is a directory" (exit 123), which —
		# under set -e + pipefail — would kill the whole script after it had
		# already printed output, yielding a failed injected command. Filter to
		# regular files and sum, so a non-file entry can't abort the run.
		local untracked_loc
		untracked_loc=$(git ls-files --others --exclude-standard -z |
			while IFS= read -r -d '' f; do [ -f "$f" ] && wc -l <"$f"; done |
			awk '{s+=$1} END{print s+0}')
		echo "untracked: +${untracked_loc}"
		echo
	fi

	# --- match changed paths against each rule's own paths: frontmatter ------
	echo "## Rule files to read"
	local found=0 rf
	for rf in "$rules_dir"/*.md; do
		[ -n "$(rule_globs "$rf")" ] || continue # no paths: => loads at launch
		if rule_matches "$rf" "${changed[@]}"; then
			echo "$rf"
			found=$((found + 1))
		fi
	done
	[ "$found" -eq 0 ] && echo "(none — no changed path matches any path-scoped rule)"

	# --- what NOT to read ----------------------------------------------------
	echo
	echo "## Already in context — do NOT read these (no paths: frontmatter, so they load at launch)"
	for rf in "$rules_dir"/*.md; do
		[ -n "$(rule_globs "$rf")" ] || echo "$rf"
	done
	echo "context/current-feature.md"

	# --- maintainer cross-check ----------------------------------------------
	# The dual frontmatter has to stay in sync by hand; surface a mismatch
	# rather than let the two tools silently disagree about a rule's scope.
	local warned=0 trigger want
	for rf in "$rules_dir"/*.md; do
		trigger="$(rule_trigger "$rf")"
		if [ -n "$(rule_globs "$rf")" ]; then want=glob; else want=always_on; fi
		if [ -n "$trigger" ] && [ "$trigger" != "$want" ]; then
			[ "$warned" -eq 0 ] && {
				echo
				echo "## Frontmatter warnings"
				warned=1
			}
			echo "$rf: trigger: $trigger but paths: implies $want — keys are out of sync"
		fi
	done
}

# Run only when executed directly, so globcheck.sh can source the functions.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
	main "$@"
fi
