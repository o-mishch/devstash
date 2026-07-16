#!/usr/bin/env bash
# Unit tests for resolve-context.sh's path matching and rule classification.
#
# Why this exists: the failure mode of a wrong matcher is a rule that silently
# never loads — the audit still runs, still reports, and simply never applies
# that rule. Nothing surfaces it. That bug has already shipped twice here: once
# as SKILL.md's hand-maintained trigger table drifting from legacy-ops.md's real
# globs, and once as this script keying on `trigger:` instead of `paths:`.
#
# Usage: globcheck.sh   (exits non-zero on any failure)

set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./resolve-context.sh
source "$here/resolve-context.sh"

pass=0
fail=0

# check <glob> <path> <expected Y|N>
check() {
	local got
	if printf '%s' "$2" | grep -Eq "^$(glob_to_ere "$1")$"; then got=Y; else got=N; fi
	if [ "$got" = "$3" ]; then
		pass=$((pass + 1))
	else
		fail=$((fail + 1))
		printf '  FAIL  %-26s %-46s -> %s (want %s)\n' "$1" "$2" "$got" "$3"
	fi
}

echo "== glob matching =="

# Shared frontend globs must not leak across the src/ | web/ boundary.
check 'web/**/*.tsx' 'web/src/components/items/item-card.tsx' Y
check 'web/**/*.ts' 'web/src/hooks/use-items.ts' Y
check 'web/**/*' 'web/src/stores/ui.ts' Y
check 'src/**/*.ts' 'web/src/hooks/use-items.ts' N
check 'src/**/*.tsx' 'web/src/components/items/item-card.tsx' N
check 'backend/**/*.go' 'web/src/x.go' N

# legacy-ops.md's real globs — the row that drifted in SKILL.md's old table. These three
# (package.json, .env*, prisma/**/*) are its whole `paths:` frontmatter; keep them in step
# with the rule file, since a case here that no rule globs proves nothing about the mapping.
check 'package.json' 'package.json' Y
check 'package.json' 'web/package.json' N
check 'package.json' 'backend/tools/package.json' N
check '.env*' '.env' Y
check '.env*' '.env.local' Y
check '.env*' 'web/.env.local' N
check 'prisma/**/*' 'prisma/schema.prisma' Y
check 'prisma/**/*' 'prisma/migrations/001/migration.sql' Y

# Glob-engine coverage: patterns no rule currently uses, kept because they exercise a
# distinct matcher shape (a bare-name prefix wildcard, and a root-anchored dir tree) that
# a rule could adopt tomorrow.
check 'playwright.config*' 'playwright.config.ts' Y
check 'e2e/**/*' 'e2e/auth.spec.ts' Y

# `**/` must match zero directories as well as many.
check 'src/**/*.ts' 'src/auth.ts' Y
check 'src/**/*.ts' 'src/lib/db/items.ts' Y
check 'backend/**/*.go' 'backend/main.go' Y
check 'backend/**/*.go' 'backend/internal/items/list.go' Y
check 'src/app/api/**/route.ts' 'src/app/api/route.ts' Y
check 'src/app/api/**/route.ts' 'src/app/api/items/route.ts' Y

# Exact-file globs must not match siblings.
check 'src/auth.ts' 'src/auth.ts' Y
check 'src/auth.ts' 'src/auth.config.ts' N
check 'src/types/actions.ts' 'src/types/actions.ts' Y
check 'src/lib/infra/rate-limit.ts' 'src/lib/infra/rate-limit.ts' Y

# `*` must not cross a path segment.
check 'infra/cli/**/*.py' 'infra/cli/a/b.py' Y
check 'infra/cli/**/*.py' 'infra/other/b.py' N

echo "== rule classification (must key on paths:, not trigger:) =="

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

cat >"$tmp/scoped.md" <<'EOF'
---
trigger: glob
paths:
  - "web/**/*"
description: x
---
EOF

cat >"$tmp/always.md" <<'EOF'
---
trigger: always_on
description: x
---
EOF

# A path-scoped rule whose trigger: is typo'd must still resolve — trigger: is
# Antigravity's unverified field, paths: is what Claude Code actually scopes on.
cat >"$tmp/typo.md" <<'EOF'
---
trigger: gloB_TYPO
paths:
  - "web/**/*"
description: x
---
EOF

expect() { # expect <label> <actual> <want>
	if [ "$2" = "$3" ]; then pass=$((pass + 1)); else
		fail=$((fail + 1))
		printf '  FAIL  %-40s -> %s (want %s)\n' "$1" "$2" "$3"
	fi
}

expect "scoped.md has globs" "$([ -n "$(rule_globs "$tmp/scoped.md")" ] && echo Y || echo N)" Y
expect "always.md has no globs" "$([ -n "$(rule_globs "$tmp/always.md")" ] && echo Y || echo N)" N
expect "typo.md still has globs" "$([ -n "$(rule_globs "$tmp/typo.md")" ] && echo Y || echo N)" Y
expect "typo.md matches web/ change" "$(rule_matches "$tmp/typo.md" web/src/x.tsx && echo Y || echo N)" Y
expect "scoped.md ignores backend change" "$(rule_matches "$tmp/scoped.md" backend/main.go && echo Y || echo N)" N
expect "trigger read back" "$(rule_trigger "$tmp/typo.md")" gloB_TYPO

echo
echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
