"""Tests for ci/run_migrations.py — capture-then-delete, patched apply, gate outcome mapping."""

from pathlib import Path

import pytest

from devstash_infra.ci import run_migrations as run_migrations_mod
from devstash_infra.ci.run_migrations import run_migrations
from devstash_infra.clients.kubectl import Kubectl
from devstash_infra.clients.yq import Yq
from devstash_infra.job_gate import JobGate
from devstash_infra.shared.errors import InfraError

_MANIFEST = Path("/repo/infra/k8s/overlays/gcp/migrate-job.yaml")


class _FakeKubectl:
    """Scripts the migrate flow: prior logs, delete, apply, the gate's condition, final logs."""

    def __init__(self, *, gate: str, prior_logs: str = "") -> None:
        self._gate = gate  # "Complete" | "Failed" | "" (timeout)
        self._prior_logs = prior_logs
        self.events: list[str] = []
        self.applied: str | None = None

    def job_logs(self, job: str, *, namespace: str, tail: int) -> str:
        # First call (tail=100) is the pre-delete capture; later (tail=50) is the success dump.
        if tail == 100:
            self.events.append("capture-prior")
            return self._prior_logs
        return "final logs"

    def delete_job(self, job: str, *, namespace: str) -> None:
        self.events.append(f"delete:{job}")

    def apply_stdin(self, manifest: str) -> None:
        self.events.append("apply")
        self.applied = manifest

    def job_condition(self, job: str, condition: str, *, namespace: str) -> str:
        return "True" if condition == self._gate else ""

    def describe(self, resource: str, *, namespace: str) -> str:
        return "job desc"


class _FakeYq:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, str]] = []

    def eval(
        self, expression: str, input_path: str, *, env_extra: dict[str, str] | None = None
    ) -> str:
        image = (env_extra or {}).get("MIGRATE_IMAGE", "")
        self.calls.append((expression, input_path, image))
        return f"kind: Job # image={image}\n"


def _kubectl(fake: _FakeKubectl) -> Kubectl:
    return fake  # type: ignore[return-value]


def _yq(fake: _FakeYq) -> Yq:
    return fake  # type: ignore[return-value]


def test_complete_applies_patched_manifest_in_order() -> None:
    kubectl = _FakeKubectl(gate="Complete", prior_logs="earlier failure trace")
    yq = _FakeYq()
    run_migrations(
        _kubectl(kubectl),
        _yq(yq),
        namespace="devstash",
        migrate_image="reg/migrate@sha256:abc",
        manifest_path=_MANIFEST,
    )
    # capture prior logs BEFORE deleting, then apply the image-patched manifest.
    assert kubectl.events == ["capture-prior", "delete:devstash-migrate", "apply"]
    assert yq.calls == [
        (".spec.template.spec.containers[0].image = strenv(MIGRATE_IMAGE)",
         str(_MANIFEST), "reg/migrate@sha256:abc")
    ]  # fmt: skip
    assert kubectl.applied == "kind: Job # image=reg/migrate@sha256:abc\n"


def test_failed_gate_raises() -> None:
    kubectl = _FakeKubectl(gate="Failed")
    with pytest.raises(InfraError, match="reached Failed condition"):
        run_migrations(
            _kubectl(kubectl),
            _yq(_FakeYq()),
            namespace="devstash",
            migrate_image="reg/migrate@sha256:abc",
            manifest_path=_MANIFEST,
        )


def test_timeout_gate_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    # The 600s deadline isn't pollable in a test, so stub the gate to report TIMEOUT and assert the
    # outcome→wording mapping (the gate's own timeout mechanics are covered in test_job_gate).
    def _timeout_gate(*_args: object, **_kwargs: object) -> JobGate:
        return JobGate.TIMEOUT

    monkeypatch.setattr(run_migrations_mod, "wait_for_job_gate", _timeout_gate)
    with pytest.raises(InfraError, match="did not complete within 600s"):
        run_migrations(
            _kubectl(_FakeKubectl(gate="")),
            _yq(_FakeYq()),
            namespace="devstash",
            migrate_image="reg/migrate@sha256:abc",
            manifest_path=_MANIFEST,
        )
