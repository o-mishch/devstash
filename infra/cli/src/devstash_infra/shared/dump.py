"""shared/dump.py — the Cloud SQL dump-verify gate + GCS version prune.

3.14 floor, stdlib-only. Port of infra/lib/posix/dump.sh — the ONE source of truth
for export → verify-non-empty → (delete-empty + retry) [fix #4] and the per-object
version prune, shared by the laptop `run.sh suspend`/`dump-db` and the Cloud Build
auto-suspend dump step.

EVERYTHING IS A PARAMETER (dump.sh:15-21): no ambient env reads.
"""

import sys
from dataclasses import dataclass

from devstash_infra.shared import proc


@dataclass(frozen=True)
class DumpResult:
    """Outcome of export_and_verify_dump.

    `verified` is the data-safety gate: the caller MUST turn `verified is False`
    into its own abort — NEVER destroy an un-dumped instance (dump.sh:35-36). The
    bash returned the size via the DS_DUMP_SIZE_BYTES global (POSIX has no nameref);
    here it is a proper return value, and `size_bytes` is None unless verified.
    """

    verified: bool
    size_bytes: int | None


def _object_size(uri: str) -> int | None:
    """Size in bytes of the GCS object at `uri`, or None if missing/non-numeric."""
    res = proc.run(
        ["gcloud", "storage", "objects", "describe", uri, "--format=value(size)"],
        check=False,
    )
    if not res.ok:
        return None
    raw = res.out.strip()
    if not raw or not raw.isdigit():  # '' | *[!0-9]* → fall through to delete + retry
        return None
    return int(raw)


def export_and_verify_dump(instance: str, uri: str, database: str, project: str) -> DumpResult:
    """Server-side export of `database` to `uri`, then verify non-empty [fix #4].

    Ports ds_export_and_verify_dump (dump.sh:37). `gcloud sql export` can leave a
    0-byte object behind on a transient failure; re-exporting over it would then be
    verified against that stale empty object, so the ONE retry deletes the empty/
    partial object FIRST. Returns verified=True with the size once a non-empty dump
    is confirmed, else verified=False after the retry (the caller aborts on that).

    Progress lines go to stderr so a caller may capture stdout without them.

    NOTE: this retry is a plain stdlib loop, NOT tenacity — the CLI zone uses
    tenacity for retry/poll, but this module is on the stdlib-only Cloud Build floor
    (zero runtime install, auto-suspend.tf:240), so no third-party import is allowed.
    """
    for attempt in (1, 2):
        sys.stderr.write(
            f"Exporting Cloud SQL '{instance}' -> {uri} "
            f"(server-side pg_dump, attempt {attempt}/2)\n"
        )
        # A failed export is non-fatal here — we verify the object regardless and
        # retry (matches the shell's `|| echo ... >&2`, never aborting on export rc).
        export = proc.run(
            [
                "gcloud",
                "sql",
                "export",
                "sql",
                instance,
                uri,
                f"--database={database}",
                f"--project={project}",
            ],
            check=False,
        )
        if not export.ok:
            sys.stderr.write(f"gcloud sql export failed (attempt {attempt})\n")

        size = _object_size(uri)
        if size is not None and size > 0:
            return DumpResult(verified=True, size_bytes=size)

        shown = size if size is not None else "none"
        sys.stderr.write(
            f"dump {uri} missing or empty (size='{shown}') — deleting partial object before retry\n"
        )
        # Delete the empty/partial object before the retry so attempt 2 verifies a
        # fresh export, not the stale 0-byte object. Best-effort.
        proc.run(["gcloud", "storage", "rm", uri, "--quiet"], check=False)

    return DumpResult(verified=False, size_bytes=None)


def prune_dump_versions(prefix: str, keep_total: int) -> None:
    """Synchronously cap object-version history under `prefix` to `keep_total`.

    Ports ds_prune_dump_versions (dump.sh:74) — the complement to the bucket's async
    GCS lifecycle rule. Generation numbers increase monotonically, so a reverse sort
    on the `#<generation>` suffix is newest-first without parsing timestamps. Grouped
    PER object path so a multi-object prefix keeps `keep_total` per object.

    SAFETY: keep_total < 1 is refused and returns BEFORE any ls/rm — a keep of 0
    would risk the live object (dump.sh:79). Best-effort throughout: a prune failure
    must NEVER abort the suspend that triggered it (the verified dump is already safe
    and the lifecycle rule backstops anything left behind).
    """
    if keep_total < 1:
        sys.stderr.write(
            f"prune_dump_versions: keep={keep_total} < 1 — skipping (would risk the live object)\n"
        )
        return

    # -a includes noncurrent generations; the trailing ** matches every object.
    listing = proc.run(["gcloud", "storage", "ls", "-a", f"{prefix}**"], check=False)
    if not listing.ok:
        return
    urls = [ln for ln in listing.out.splitlines() if "#" in ln]
    # Reverse sort → newest generation first per object path (monotonic generations).
    urls.sort(reverse=True)
    if not urls:
        return

    # Group by object path (strip the #generation); keep the newest keep_total per path.
    seen: dict[str, int] = {}
    stale: list[str] = []
    for url in urls:
        path = url.split("#", 1)[0]
        seen[path] = seen.get(path, 0) + 1
        if seen[path] > keep_total:
            stale.append(url)
    if not stale:
        return

    sys.stderr.write(
        f"Pruning superseded dump version(s) at {prefix} (keeping newest {keep_total} per object)\n"
    )
    # Delete every stale #generation in ONE gcloud call via -I (URLs on stdin) rather
    # than one `rm` per URL — pays the gcloud startup+auth cost once. -c continues on
    # error (best-effort). Each URL is an explicit #<generation>, so this can never
    # touch the live object as long as keep_total >= 1.
    proc.run(
        ["gcloud", "storage", "rm", "-I", "-c", "--quiet"],
        check=False,
        input="\n".join(stale) + "\n",
    )
