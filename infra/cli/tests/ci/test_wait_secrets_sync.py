"""Tests for ci/wait_secrets_sync.py — the post-timeout classification (parity with the bats suite).

The regression under test (three prior outages): a not-Ready ExternalSecret must be classified by
ESO's own `reason=UpdateFailed` Event, NOT by reading the secret payload. The benign parked state
(missing infra property) warns + returns False (`synced=false`, exit 0); every other timeout —
no event, a kubectl error, a still-DISABLED version, or any other reason — RAISES (loud fail).
"""

import pytest

from devstash_infra.ci.wait_secrets_sync import wait_for_sync
from devstash_infra.clients.kubectl import Kubectl
from devstash_infra.shared.errors import InfraError
from devstash_infra.shared.proc import Result


def _event(stdout: str = "", *, stderr: str = "", code: int = 0) -> Result:
    return Result(["kubectl", "get", "events"], stdout, stderr, code)


class _FakeKubectl:
    """Scripts `wait_condition` (a bool sequence) + the newest event; records annotate nudges."""

    def __init__(self, *, waits: list[bool], event: Result, describe_out: str = "") -> None:
        self._waits = list(waits)
        self._event = event
        self._describe = describe_out
        self.annotations = 0

    def annotate(self, resource: str, key: str, value: str, *, namespace: str) -> None:
        self.annotations += 1

    def wait_condition(
        self, resource: str, condition: str, *, namespace: str, timeout: str
    ) -> bool:
        return self._waits.pop(0) if self._waits else False

    def newest_event_message(self, name: str, reason: str, *, namespace: str) -> Result:
        return self._event

    def describe(self, resource: str, *, namespace: str) -> str:
        return self._describe


def _kubectl(fake: _FakeKubectl) -> Kubectl:
    return fake  # type: ignore[return-value]


def _run(fake: _FakeKubectl, *, timeout_s: int = 0) -> bool:
    return wait_for_sync(
        _kubectl(fake), namespace="devstash", timeout_s=timeout_s, nudge_interval_s=1
    )


def test_synced_returns_true_without_classifying() -> None:
    assert _run(_FakeKubectl(waits=[True], event=_event())) is True


def test_renudge_loop_catches_a_later_ready(capsys: pytest.CaptureFixture[str]) -> None:
    # Ready on the SECOND wait — proves the loop re-nudged rather than blocking once (the fix).
    fake = _FakeKubectl(waits=[False, True], event=_event())
    assert _run(fake, timeout_s=60) is True
    assert fake.annotations >= 2  # re-annotated each iteration
    assert "secrets synced" in capsys.readouterr().out


def test_missing_property_warns_and_returns_false(capsys: pytest.CaptureFixture[str]) -> None:
    fake = _FakeKubectl(
        waits=[False],
        event=_event("key redis-url does not exist in secret devstash-app-config"),
    )
    assert _run(fake) is False  # benign parked state → synced=false, exit 0
    assert "::warning::" in capsys.readouterr().out


def test_no_event_fails_loudly() -> None:
    fake = _FakeKubectl(waits=[False], event=_event(""))  # ok, but empty
    with pytest.raises(InfraError, match="no UpdateFailed events"):
        _run(fake)


def test_kubectl_error_fails_loudly_surfacing_the_error() -> None:
    fake = _FakeKubectl(waits=[False], event=_event("", stderr="connection refused", code=1))
    with pytest.raises(InfraError, match="kubectl get events failed") as exc:
        _run(fake)
    assert "connection refused" in exc.value.message


def test_still_disabled_after_budget_fails_loudly() -> None:
    fake = _FakeKubectl(
        waits=[False],
        event=_event("Secret Version [.../versions/2] is in DISABLED state"),
    )
    with pytest.raises(InfraError, match="DISABLED secret version"):
        _run(fake)


def test_other_failure_reason_fails_loudly() -> None:
    fake = _FakeKubectl(
        waits=[False],
        event=_event("unable to access Secret: rpc error: code = PermissionDenied"),
    )
    with pytest.raises(InfraError, match="other than a missing infra property"):
        _run(fake)
