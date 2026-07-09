"""Tests for state_lock.py — the lock-aware / network-retry tofu runner.

Parity port of the tofu_locked cases from state-lock.bats + common.bats: lock
recover-once, bounded network retry, and loud-first-failure for everything else.
The runner is driven with a scripted `run_op` returning canned Results — no real
tofu, no real sleeps (network_gap=0).
"""

from devstash_infra.shared.proc import Result
from devstash_infra.state_lock import tofu_locked

_LOCK_ERR = "Error acquiring the state lock: ..."
_NET_ERR = "http2: client connection lost"


def _result(code: int, stdout: str = "") -> Result:
    return Result(argv=["tofu", "apply"], stdout=stdout, stderr="", code=code)


def _ok() -> Result:
    return _result(0, "Apply complete")


class _Op:
    """A scripted run_op: yields the next Result each call, records call count."""

    def __init__(self, *results: Result) -> None:
        self._results = list(results)
        self.calls = 0

    def __call__(self) -> Result:
        self.calls += 1
        return self._results.pop(0)


class TestLockBranch:
    def test_lock_then_success_recovers_retries_once(self) -> None:
        op = _Op(_result(1, _LOCK_ERR), _ok())
        recovered = {"n": 0}

        def recover() -> bool:
            recovered["n"] += 1
            return True

        result = tofu_locked(op, recover, network_gap=0)
        assert result.ok
        assert op.calls == 2  # initial + exactly one retry
        assert recovered["n"] == 1

    def test_second_lock_failure_after_recovery_repropagates(self) -> None:
        # Recovery runs, retry still hits the lock → return that, do NOT loop.
        op = _Op(_result(1, _LOCK_ERR), _result(1, _LOCK_ERR))
        result = tofu_locked(op, lambda: True, network_gap=0)
        assert not result.ok
        assert op.calls == 2  # never a third attempt

    def test_recovery_declined_repropagates_without_retry(self) -> None:
        op = _Op(_result(1, _LOCK_ERR))
        result = tofu_locked(op, lambda: False, network_gap=0)
        assert not result.ok
        assert op.calls == 1  # no retry when recovery declines

    def test_non_lock_failure_never_calls_recovery(self) -> None:
        op = _Op(_result(1, "Error: invalid credentials"))
        recover_called = {"n": 0}

        def recover() -> bool:
            recover_called["n"] += 1
            return True

        result = tofu_locked(op, recover, network_gap=0)
        assert not result.ok
        assert op.calls == 1  # fails loudly on the first attempt
        assert recover_called["n"] == 0


class TestNetworkRetry:
    def test_transient_drop_then_success(self) -> None:
        op = _Op(_result(1, _NET_ERR), _ok())
        result = tofu_locked(op, lambda: False, network_retries=3, network_gap=0)
        assert result.ok
        assert op.calls == 2  # 1 initial + 1 network retry

    def test_bounded_gives_up_and_repropagates(self) -> None:
        # Always a network drop → 1 initial + network_retries more, then re-propagate.
        op = _Op(*[_result(1, _NET_ERR) for _ in range(4)])
        result = tofu_locked(op, lambda: False, network_retries=3, network_gap=0)
        assert not result.ok
        assert op.calls == 4  # 1 + 3 (bounded)

    def test_non_network_non_lock_not_retried(self) -> None:
        op = _Op(_result(1, "Error: quota exceeded"))
        result = tofu_locked(op, lambda: False, network_retries=3, network_gap=0)
        assert not result.ok
        assert op.calls == 1  # loud on the first attempt, no retry

    def test_network_then_hard_error_stops_retrying(self) -> None:
        # A non-network failure mid-retry stops the loop and returns that result.
        op = _Op(_result(1, _NET_ERR), _result(1, "Error: real provider conflict"))
        result = tofu_locked(op, lambda: False, network_retries=3, network_gap=0)
        assert not result.ok
        assert op.calls == 2  # stopped as soon as the error was non-network
