"""Tests for ci/wait_rollout.py — the rollout gate + no-auto-rollback diagnostics."""

import pytest

from devstash_infra.ci.wait_rollout import wait_rollout
from devstash_infra.clients.kubectl import Kubectl
from devstash_infra.shared.errors import InfraError
from devstash_infra.shared.proc import ProcError, Result


class _FakeKubectl:
    """Scripts `rollout_status` (ok/raise) + the three diagnostic reads."""

    def __init__(self, *, rollout_ok: bool, pods: list[str] | None = None) -> None:
        self._rollout_ok = rollout_ok
        self._pods = pods or []
        self.rollouts: list[tuple[str, str]] = []
        self.previous_logs_for: list[str] = []

    def rollout_status(self, resource: str, *, namespace: str, timeout: str) -> None:
        self.rollouts.append((resource, timeout))
        if not self._rollout_ok:
            raise ProcError(Result([resource], "", "timed out", 1))

    def describe(self, resource: str, *, namespace: str) -> str:
        return "Events:\n  Warning  FailedScheduling"

    def pod_names(self, selector: str, *, namespace: str) -> list[str]:
        return self._pods

    def previous_logs(self, pod: str, *, namespace: str, tail: int) -> str:
        self.previous_logs_for.append(pod)
        return f"panic in {pod}"


def _kubectl(fake: _FakeKubectl) -> Kubectl:
    return fake  # type: ignore[return-value]


def test_successful_rollout_returns_and_targets_web_deployment() -> None:
    fake = _FakeKubectl(rollout_ok=True)
    wait_rollout(_kubectl(fake), namespace="devstash")
    assert fake.rollouts == [("deployment/devstash-web", "300s")]


def test_failed_rollout_raises_with_fix_forward_hint(capsys: pytest.CaptureFixture[str]) -> None:
    fake = _FakeKubectl(rollout_ok=False, pods=["pod/web-a", "pod/web-b"])
    with pytest.raises(InfraError) as excinfo:
        wait_rollout(_kubectl(fake), namespace="devstash")
    assert "DO NOT roll back" in excinfo.value.hint  # [no-auto-rollback: schema already advanced]
    assert fake.previous_logs_for == ["pod/web-a", "pod/web-b"]  # per-pod previous logs collected
    err = capsys.readouterr().err
    assert "Logs from failing pods" in err and "panic in pod/web-a" in err


def test_failed_rollout_with_no_pods_still_raises(capsys: pytest.CaptureFixture[str]) -> None:
    fake = _FakeKubectl(rollout_ok=False, pods=[])
    with pytest.raises(InfraError):
        wait_rollout(_kubectl(fake), namespace="devstash")
    assert fake.previous_logs_for == []  # no pods → no log fetches, but still a loud fail
