"""job_gate.py — poll a Kubernetes Job to a terminal condition. CLI zone (3.14).

Port of common.sh:wait_for_job_gate + ds_dump_job_diagnostics — the SINGLE gate both the CI
`run-migrations` step and local `run_migrate` wrap, so the two paths can never drift on the gate
logic. `kubectl wait` takes only ONE `--for` value (a repeated flag just lets the last win, so it
can't race Complete against Failed); polling BOTH conditions lets a Failed Job abort immediately
instead of consuming the full deadline. The caller maps the outcome to its own wording (CI emits a
`::error::`; local `die`s) — this returns the outcome and owns the diagnostics dump.
"""

import enum
import time
from collections.abc import Callable

import typer

from devstash_infra.clients.kubectl import Kubectl

_POLL_GAP_S = 5.0
_DIAG_TAIL = 200


class JobGate(enum.Enum):
    """Terminal outcome of the Job gate (maps to the shell's 0/1/2 return codes)."""

    COMPLETE = "complete"  # 0 — the Job reached Complete=True
    FAILED = "failed"  # 1 — the Job reached Failed=True (aborts before the deadline)
    TIMEOUT = "timeout"  # 2 — neither condition within the deadline


def wait_for_job_gate(
    kubectl: Kubectl,
    *,
    namespace: str,
    job: str,
    deadline_s: float,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
) -> JobGate:
    """Poll `job` until Complete/Failed or `deadline_s` elapses; dump diagnostics on a bad outcome.

    `clock`/`sleep` are injected so tests drive the deadline without real waits. Complete is checked
    before Failed each pass (a Job that both completed and had a transient failure reads as done).
    """
    deadline = clock() + deadline_s
    while clock() < deadline:
        if kubectl.job_condition(job, "Complete", namespace=namespace) == "True":
            return JobGate.COMPLETE
        if kubectl.job_condition(job, "Failed", namespace=namespace) == "True":
            _dump_job_diagnostics(kubectl, namespace, job)
            return JobGate.FAILED
        sleep(_POLL_GAP_S)
    _dump_job_diagnostics(kubectl, namespace, job)
    return JobGate.TIMEOUT


def _dump_job_diagnostics(kubectl: Kubectl, namespace: str, job: str) -> None:
    """Print the Job's logs + describe to stderr — the post-mortem for a Failed/timed-out gate."""
    typer.echo(kubectl.job_logs(job, namespace=namespace, tail=_DIAG_TAIL), err=True)
    typer.echo(kubectl.describe(f"job/{job}", namespace=namespace), err=True)
