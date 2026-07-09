"""shared/secrets.py — read Secret Manager secrets by newest ENABLED version.

3.14 floor, stdlib-only. Port of infra/lib/posix/secrets.sh — the ONE source of
truth for the "avoid `access latest`" hardening [fix #14].

WHY newest-ENABLED, not `access latest` (secrets.sh:13-16): `latest` points at the
highest-numbered version REGARDLESS of state, so a single DISABLED/DESTROYED top
version (e.g. left by an interrupted rotation) makes `access latest` fail with
FAILED_PRECONDITION and blocks the read — unattended, that blocks the whole
suspend. Resolving the newest state:ENABLED version sidesteps that.

EVERYTHING IS A PARAMETER (secrets.sh:19-22): no ambient env reads, so the same
code serves the CLI and the Cloud Build auto-suspend path (which git-clones + runs
this module on cloud-sdk:slim's python3 with zero install).
"""

from devstash_infra.shared import proc


def newest_enabled_secret_version(secret: str, project: str) -> str:
    """Resource name of the newest state:ENABLED version of `secret`, or "".

    Non-fatal: empty string when the secret is absent / has no enabled version —
    callers layer their own fatal-vs-tolerant policy on the empty result. Ports
    ds_newest_enabled_secret_version (secrets.sh:32); the gcloud argv is identical
    (`--filter=state:ENABLED --sort-by=~createTime --limit=1`).
    """
    result = proc.run(
        [
            "gcloud",
            "secrets",
            "versions",
            "list",
            secret,
            f"--project={project}",
            "--filter=state:ENABLED",
            "--sort-by=~createTime",
            "--limit=1",
            "--format=value(name)",
        ],
        check=False,  # tolerant: `2>/dev/null || true` — empty on any failure
    )
    return result.out if result.ok else ""


def access_secret_blob(secret: str, project: str) -> str:
    """Payload of `secret`'s newest ENABLED version, or "" (tolerant).

    Ports ds_access_secret_blob (secrets.sh:43): resolve-newest-enabled → access →
    tolerate-missing. A fatal caller (Cloud Build prepare) resolves the version
    itself and dies on empty instead of calling this.
    """
    version = newest_enabled_secret_version(secret, project)
    if not version:
        return ""
    result = proc.run(
        [
            "gcloud",
            "secrets",
            "versions",
            "access",
            version,
            f"--secret={secret}",
            f"--project={project}",
        ],
        check=False,
    )
    return result.out if result.ok else ""
