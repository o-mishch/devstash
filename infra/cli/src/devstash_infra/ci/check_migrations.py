"""ci/check_migrations.py — static safety analysis of pending migrations before build/deploy.

CLI zone (3.14). Port of infra/ci/check-migrations.sh (migration-safety.yml). Runs pgfence over
every `migration.sql` to catch dangerous statements (DROP COLUMN, lock-heavy ALTER, non-CONCURRENT
index, renames) that would cause downtime or data loss during a rolling update. Risk/lock policy
lives in the committed `.pgfence.json` (max-risk=low) — NOT duplicated here, so local and CI never
drift. Fix a failing migration with the expand-contract pattern before merging.

pgfence is a lockfile-pinned devDependency; `--no-install` forbids npx from downloading a different
package at deploy time. Hard-fails (raises `ProcError`) so a risky migration reds the check.
"""

from pathlib import Path

from devstash_infra.common import log, ok
from devstash_infra.shared import proc

_MIGRATION_GLOB = (
    "**/migration.sql"  # recursive: prisma/migrations/<timestamp>_<name>/migration.sql
)


def check_migrations(migrations_root: Path) -> None:
    """Analyze every `migration.sql` under `migrations_root` with pgfence; raise on a risky finding.

    Replaces the shell's `shopt -s globstar` + `**` glob with pathlib's recursive glob (no runner-
    shell dependency). Files are sorted so the analyzed set — and the argv — is deterministic.
    """
    files = sorted(str(path) for path in migrations_root.glob(_MIGRATION_GLOB))
    log(f"Analyzing {len(files)} migration file(s) with pgfence…")
    proc.run(["npx", "--no-install", "pgfence", "analyze", "--ci", *files])
    ok("migrations passed pgfence safety analysis")
