"""shared/reconcile_ar_iam.py — purge stranded repo-scoped AR IAM members from state.

3.14 floor, stdlib-only. Port of the reconcile-ar-iam POSIX helper — the ONE
source of truth for the reconcile LOOP (the complement to the address DATA in
infra/data/ar-iam-member-addresses.txt). Shared by the laptop `apply`/`suspend`
reconcile branch 4 and the Cloud Build suspend step.

WHY the stranding happens (reconcile-ar-iam.sh:14-22): the AR repo + its 3 repo-
scoped IAM members are gated on environment_active, so a deep suspend destroys them
THROUGH Terraform (state count→0). A suspend that ran BEFORE the destroy-order fix
destroyed the repo FIRST, then 403'd removing the members via the now-vanished repo
— leaving them in state pointing at a repo GCP no longer has. The next apply retries
the same repo-scoped setIamPolicy and 403s AGAIN, re-wedging every apply/resume. They
can't be destroyed through the API (no repo to setIamPolicy on), so purge them from
state; resume recreates them.

SELF-DISABLING + SAFE: acts ONLY when the repo is genuinely ABSENT in GCP (the exact
stranded signature). A present repo → members legitimately managed, left untouched.
Each `state rm` is guarded by an exact-address `state list` check (authoritative — no
whole-list grep), so once purged / on a clean env this is a no-op. Needs `tofu` on
PATH (narrower than the cloud-sdk helpers; both callers run it after `tofu init`).

EVERYTHING IS A PARAMETER (reconcile-ar-iam.sh:29-33): no ambient env reads.
"""

import sys
from pathlib import Path

from devstash_infra.shared import proc
from devstash_infra.shared.errors import InfraError


def purge_stranded_ar_iam(repo: str, region: str, project: str, addr_file: str) -> bool:
    """If `repo` is ABSENT in GCP, `tofu state rm` each tracked address in `addr_file`.

    Ports ds_purge_stranded_ar_iam (reconcile-ar-iam.sh:45). A present repo, or an
    already-clean state, is a no-op. Returns True on success; False on a failed
    `state rm` so the caller can escalate (a stranded member that cannot be purged
    must NOT be silently swallowed, unlike the best-effort NEG/dump helpers).

    Blank and `#`-comment lines in `addr_file` are skipped. Each `state rm` is gated
    by an exact-address `state list` check so an unrelated line can't fool it and
    `state rm` is never called on an absent address (which would exit non-zero).
    """
    # Only the exact stranded signature: repo gone in GCP. Present repo → managed.
    if proc.run_ok(
        [
            "gcloud",
            "artifacts",
            "repositories",
            "describe",
            repo,
            f"--location={region}",
            f"--project={project}",
        ]
    ):
        return True

    addr_path = Path(addr_file)
    if not addr_path.is_file():
        # The repo is gone but we cannot read the tracked-address list — fail with a clear message
        # at the boundary rather than a bare FileNotFoundError past the InfraError-only catch.
        raise InfraError(f"AR-IAM address file not found: {addr_file}")

    for raw in addr_path.read_text().splitlines():
        addr = raw.strip()
        if not addr or addr.startswith("#"):
            continue
        # Exact-address state-list check (authoritative — no whole-list grep).
        listed = proc.run(["tofu", "state", "list", addr], check=False)
        if listed.ok and any(line == addr for line in listed.out.splitlines()):
            sys.stderr.write(
                f"Reconcile: repo '{repo}' is gone but {addr} is still in state (stranded by a "
                "pre-fix suspend) — removing from state so the next apply is not re-wedged "
                "by a 403\n"
            )
            removed = proc.run(["tofu", "state", "rm", "-lock-timeout=120s", addr], check=False)
            if not removed.ok:
                return False
    return True
