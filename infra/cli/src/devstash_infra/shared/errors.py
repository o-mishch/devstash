"""shared/errors.py — the infra exception hierarchy. 3.14 floor, stdlib-only.

ONE shallow tree so every deliberate failure is a typed `InfraError` the CLI boundary
(`runtime.guard`) catches ONCE and maps to an exit code + operator message — deep code raises
and never calls sys.exit/os._exit mid-stack (exceptions-to-boundary). Floor-resident so the
stdlib Cloud Build path raises the SAME types.

Subtypes exist ONLY where the boundary genuinely branches (a declined gate is quiet) or a test
pins the type (a plan failure). Two levels is the ceiling — resist adding a third. A failure that
only needs a distinct operator note (e.g. lock contention → "run unlock") stays a plain
`InfraError` with a `hint=` — the boundary already prints hints. `ProcError` lives in `proc.py`
beside subprocess (it carries a `Result`) but subclasses `InfraError` too.
"""


class InfraError(Exception):
    """Base for every deliberate infra failure: a user-facing message + optional hint/exit code.

    Catch this at the boundary to handle ALL infra failures uniformly; catch a subtype to branch.
    `hint` is a second, actionable line (what to do next); `exit_code` is the process exit status.
    """

    def __init__(self, message: str, *, hint: str = "", exit_code: int = 1) -> None:
        super().__init__(message)
        self.message = message
        self.hint = hint
        self.exit_code = exit_code


class Aborted(InfraError):
    """An operator declined a confirmation gate — expected; the boundary stays quiet."""


class PlanRejected(InfraError):
    """`tofu plan` failed, or the saved plan is missing/unappliable — no GCP mutation happened."""


class ClusterUnreachable(InfraError):
    """Reachability timed out: the cluster EXISTS but its control-plane endpoint never answered.

    A DISTINCT type because the resume driver branches on it [fix #11]: a reachability timeout is
    the deep-suspend DNS-endpoint propagation gap, NOT a real fault — so resume clears the CI
    cancel-trap FIRST (leaving the pre-dispatched deploy running, since its own waits may carry it
    home) and only then aborts the local bring-up. A hard fault (missing cluster / teardown in
    progress) raises the base `InfraError` instead, so the trap stays armed and the deploy dies.
    """
