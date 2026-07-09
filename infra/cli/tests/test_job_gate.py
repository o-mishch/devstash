"""Tests for job_gate.py — the migrate-Job gate (Complete/Failed/timeout + diagnostics)."""

from devstash_infra.clients.kubectl import Kubectl
from devstash_infra.job_gate import JobGate, wait_for_job_gate


class _FakeClock:
    """A monotonic clock whose `sleep` advances it — drives the deadline without real waits."""

    def __init__(self) -> None:
        self.t = 0.0

    def now(self) -> float:
        return self.t

    def sleep(self, seconds: float) -> None:
        self.t += seconds


class _FakeKubectl:
    """Returns fixed condition statuses; records whether diagnostics were dumped."""

    def __init__(self, conditions: dict[str, str]) -> None:
        self._conditions = conditions
        self.dumped = False

    def job_condition(self, job: str, condition: str, *, namespace: str) -> str:
        return self._conditions.get(condition, "")

    def job_logs(self, job: str, *, namespace: str, tail: int) -> str:
        self.dumped = True
        return "job logs"

    def describe(self, resource: str, *, namespace: str) -> str:
        return "job desc"


def _kubectl(fake: _FakeKubectl) -> Kubectl:
    return fake  # type: ignore[return-value]


def _gate(fake: _FakeKubectl, clock: _FakeClock, *, deadline_s: float = 12.0) -> JobGate:
    return wait_for_job_gate(
        _kubectl(fake),
        namespace="devstash",
        job="devstash-migrate",
        deadline_s=deadline_s,
        clock=clock.now,
        sleep=clock.sleep,
    )


def test_complete_returns_immediately_no_diagnostics() -> None:
    fake = _FakeKubectl({"Complete": "True"})
    clock = _FakeClock()
    assert _gate(fake, clock) is JobGate.COMPLETE
    assert clock.t == 0.0  # resolved on the first poll, never slept
    assert fake.dumped is False


def test_failed_aborts_before_deadline_and_dumps() -> None:
    fake = _FakeKubectl({"Failed": "True"})  # Complete absent → "" ; Failed True
    clock = _FakeClock()
    assert _gate(fake, clock) is JobGate.FAILED
    assert clock.t == 0.0  # aborted immediately, did not burn the deadline
    assert fake.dumped is True


def test_timeout_when_neither_condition_reached() -> None:
    fake = _FakeKubectl({})  # neither Complete nor Failed ever True
    clock = _FakeClock()
    assert _gate(fake, clock, deadline_s=12.0) is JobGate.TIMEOUT
    assert clock.t == 15.0  # polled 3× (5s gap) until past the 12s deadline
    assert fake.dumped is True
