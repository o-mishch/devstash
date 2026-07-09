"""gcp/parallel.py — the fail-fast parallel join [fix #11]. CLI zone (3.14).

Ports gke.sh's `_join_fail_fast`: fold N already-backgrounded jobs under one join that returns only
once ALL exit 0 and, the instant the FIRST fails, KILLS every surviving sibling (so nothing is left
installing/creating detached) and raises. Split out of `gcp/gke.py` so the cluster-targeting
collaborator isn't carrying the concurrency primitives; it is the mechanism the resume overlap
driver threads (the current shell runs that path foreground-sequential, so it has no `src/` caller
yet — it lands when the driver is wired).
"""

import contextlib
import subprocess
import time
from collections.abc import Sequence
from dataclasses import dataclass

from devstash_infra.common import fmt_dur, ok
from devstash_infra.shared.errors import InfraError


@dataclass(frozen=True)
class Job:
    """One backgrounded job in a fail-fast join: an already-launched subprocess + a label. A ""
    label joins silently (the bare-pid back-compat path); a non-empty label announces
    "✓ [label] done in <dur>" on finish.
    """

    process: subprocess.Popen[str]
    label: str = ""


def _kill_quietly(process: subprocess.Popen[str]) -> None:
    """SIGKILL a surviving sibling, ignoring an already-exited pid (gke.sh:44)."""
    if process.poll() is None:
        # already-gone pid → no-op, exactly like bash `kill` on a dead pid
        with contextlib.suppress(ProcessLookupError):
            process.kill()


def join_fail_fast(
    jobs: Sequence[Job],
    die_msg: str,
    *,
    t0: float | None = None,
    poll_interval: float = 0.02,
) -> None:
    """Fold N backgrounded jobs under one fail-fast join [fix #11] (gke.sh:_join_fail_fast).

    Returns once ALL jobs exit 0. The instant the FIRST exits non-zero it KILLS every still-running
    sibling (so nothing is left installing/creating detached) and raises `InfraError` with
    `die_msg`. An empty job set is a no-op success.

    The bash `wait -n -p` (learn WHICH pid finished each iteration) becomes a poll over
    `Popen.poll()`; killing the survivors' processes is the faithful, stronger form of the shell's
    `kill "$p"` — it terminates the detached work itself, not just an OS pid.

    Narration: a Job with a non-empty label prints "✓ [label] done in <dur>" as it lands, the
    duration measured from `t0` (the group's start — a monotonic timestamp); unlabeled jobs stay
    silent. `t0` defaults to the join's start (0 elapsed) when omitted.
    """
    start = t0 if t0 is not None else time.monotonic()
    pending = list(jobs)
    while pending:
        finished = _await_one(pending, poll_interval)
        rc = finished.process.returncode
        if rc != 0:
            for job in pending:
                if job is not finished:
                    _kill_quietly(job.process)
            raise InfraError(f"{die_msg} (a joined job exited {rc})")
        if finished.label:
            ok(f"[{finished.label}] done in {fmt_dur(time.monotonic() - start)}")
        pending.remove(finished)


def _await_one(pending: Sequence[Job], poll_interval: float) -> Job:
    """Block until one pending job's process exits; return it (the `wait -n` analogue)."""
    while True:
        for job in pending:
            if job.process.poll() is not None:
                return job
        time.sleep(poll_interval)
