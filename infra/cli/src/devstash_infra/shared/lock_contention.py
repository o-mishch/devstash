"""shared/lock_contention.py — auto-suspend state-lock contention handling.

3.14 floor, stdlib-only. Port of infra/lib/posix/lock-contention.sh AND the folded
infra/terraform/envs/dev/scripts/auto-suspend-lock-id.py (JSON→lock-ID extraction).

The three-layer defence against two auto-suspend builds racing the gke/dev tfstate
lock (lock-contention.sh:2-8): the alert AND the cron publish to one Pub/Sub topic,
so two builds can start seconds apart, both guards see a free lock (it isn't
acquired until the far-later suspend step), both proceed, and the second dies with
"Error acquiring the state lock".

- `older_autosuspend_build_running` — layer-1 dedup tiebreak by createTime.
- `parse_lock_id` (folds auto-suspend-lock-id.py) — JSON→"ID", well-formedness guard.
- `force_unlock_if_dead` [fix #1] — layer-3 guarded force-unlock, ONLY an orphaned
  lock, ALWAYS by the GCS object GENERATION, never the JSON "ID" UUID.

EVERYTHING IS A PARAMETER (lock-contention.sh:16-19): no ambient env reads.
"""

import json
import sys
from typing import cast

from devstash_infra.shared import proc


def older_autosuspend_build_running(region: str, project: str, trigger: str, self_id: str) -> bool:
    """True iff some OTHER ongoing auto-suspend build was created BEFORE this one.

    Ports ds_older_autosuspend_build_running (lock-contention.sh:37). A deterministic
    createTime tiebreak (the real lock-acquisition order): the single earliest build
    proceeds, every later one defers, so overlapping alert+cron fires collapse to one
    suspend. Fail-OPEN (return False, don't defer) on any transient `list`/`describe`
    error — the layer-2 lock-timeout and layer-3 force-unlock behind this still
    protect a build that wrongly proceeds; failing closed could skip a needed suspend.

    A tie is NOT older (`<`, strictly): an exact-createTime match proceeds.
    """
    # createTime of THIS build — the tiebreak boundary. Fail-open on a transient miss.
    self_created = proc.run(
        [
            "gcloud",
            "builds",
            "describe",
            self_id,
            f"--region={region}",
            f"--project={project}",
            "--format=value(createTime)",
        ],
        check=False,
    )
    self_ts = self_created.out if self_created.ok else ""
    if not self_ts:
        return False

    rows = proc.run(
        [
            "gcloud",
            "builds",
            "list",
            f"--region={region}",
            f"--project={project}",
            "--ongoing",
            f"--filter=substitutions.TRIGGER_NAME={trigger} AND id!={self_id}",
            "--format=value(id,createTime)",
        ],
        check=False,
    )
    rows_text = rows.out if rows.ok else ""
    if not rows_text:
        return False

    # A sibling is "older" iff its createTime sorts strictly before ours. Both are
    # fixed-width RFC-3339 UTC (…Z) stamps from the same API, so a plain string
    # comparison is the chronological order (mirrors the shell's `sort` tiebreak).
    for line in rows_text.splitlines():
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        _sibling_id, sibling_ts = parts[0], parts[1]
        if not sibling_ts:
            continue
        if sibling_ts < self_ts:  # strictly before — a tie does NOT defer
            sys.stderr.write(
                f"another auto-suspend build ({_sibling_id}) started at {sibling_ts}, "
                f"before this one ({self_ts}) — deferring to it\n"
            )
            return True
    return False


def parse_lock_id(lock_json: str) -> str:
    """Extract the OpenTofu lock "ID" from a .tflock JSON blob, or "" if malformed.

    Folds auto-suspend-lock-id.py: a malformed/empty blob yields "" so the caller
    refuses to force-unlock on a value it could not read. Note the "ID" here is the
    internal UUID used ONLY as a well-formedness guard — force-unlock addresses the
    lock by the GCS object generation, not this value (see force_unlock_if_dead).
    """
    try:
        lock: object = json.loads(lock_json)
    except ValueError:  # JSONDecodeError is a ValueError subclass — this covers both
        return ""
    if not isinstance(lock, dict):
        return ""
    # json.loads gives dict[Unknown, Unknown]; pin to a typed mapping before .get.
    lock_map = cast("dict[str, object]", lock)
    lock_id = lock_map.get("ID")
    return str(lock_id) if lock_id else ""


def force_unlock_if_dead(
    region: str, project: str, bucket: str, trigger: str, self_id: str
) -> bool:
    """Layer-3 recovery: break ONLY an orphaned lock; NEVER a live one [fix #1].

    Ports ds_force_unlock_if_dead (lock-contention.sh:90). Called after a `tofu
    apply` already failed to acquire the lock past the long -lock-timeout. Returns:
      True  ("retry")  — lock gone, or safely force-unlocked (orphaned).
      False ("no-op")  — lock is live (a sibling build is mid-destroy), or the lock
                         is present but unparseable / its generation unreadable.

    CRITICAL [fix #1]: force-unlock addresses the lock by the GCS object GENERATION
    (the numeric value tofu prints as `ID:` in its acquire-error box), NEVER the
    .tflock JSON "ID" UUID — GCS rejects the UUID with "Lock ID should be numerical
    value", silently leaving an orphaned lock in place (a real incident). The JSON
    ID is parsed first only as a guard that the object is a well-formed lock.
    """
    lock_uri = f"gs://{bucket}/gke/dev/default.tflock"

    # No lock object → released between the apply failure and now; retry the apply.
    lock_json_res = proc.run(
        ["gcloud", "storage", "cat", lock_uri, f"--project={project}"], check=False
    )
    lock_json = lock_json_res.out if lock_json_res.ok else ""
    if not lock_json:
        sys.stderr.write(
            "state lock is already gone — the holder released it; retrying the apply\n"
        )
        return True

    # Any OTHER auto-suspend build still ongoing → the lock is LIVE; do NOT break it.
    others = proc.run(
        [
            "gcloud",
            "builds",
            "list",
            f"--region={region}",
            f"--project={project}",
            "--ongoing",
            f"--filter=substitutions.TRIGGER_NAME={trigger} AND id!={self_id}",
            "--format=value(id)",
        ],
        check=False,
    )
    others_text = others.out if others.ok else ""
    if others_text:
        sys.stderr.write(
            f"state lock is held by a live auto-suspend build ({others_text}) mid-destroy "
            "— NOT force-unlocking; the sibling completes the suspend and this build is a no-op\n"
        )
        return False

    # No sibling ongoing, yet the lock persists → orphaned (a build crashed mid-apply
    # without releasing it). Parse the JSON ID as a well-formedness guard first.
    uuid = parse_lock_id(lock_json)
    if not uuid:
        sys.stderr.write(
            f"could not parse the lock ID from {lock_uri} — refusing to force-unlock blind\n"
        )
        return False

    generation = proc.run(
        [
            "gcloud",
            "storage",
            "objects",
            "describe",
            lock_uri,
            f"--project={project}",
            "--format=value(generation)",
        ],
        check=False,
    )
    gen = generation.out if generation.ok else ""
    if not gen:
        sys.stderr.write(
            f"could not read the generation of {lock_uri} — refusing to force-unlock blind\n"
        )
        return False

    sys.stderr.write(
        f"state lock (id {uuid}, generation {gen}) is orphaned (no auto-suspend build is "
        "running) — force-unlocking and retrying\n"
    )
    # Force-unlock BY THE GENERATION [fix #1], never the UUID.
    proc.run(["tofu", "force-unlock", "-force", gen])
    return True
