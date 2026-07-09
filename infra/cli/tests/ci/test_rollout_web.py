"""Tests for ci/rollout_web.py + ci/ssa_apply.py — the Deployment-only server-side apply."""

from pathlib import Path

from devstash_infra.ci.rollout_web import rollout_web
from devstash_infra.ci.ssa_apply import ssa_apply
from devstash_infra.clients.kubectl import Kubectl
from devstash_infra.clients.yq import Yq


class _FakeYq:
    def __init__(self, output: str) -> None:
        self._output = output
        self.selectors: list[str] = []

    def eval(
        self, expression: str, input_path: str, *, env_extra: dict[str, str] | None = None
    ) -> str:
        self.selectors.append(expression)
        return self._output


class _FakeKubectl:
    def __init__(self) -> None:
        self.applied: list[tuple[str, str]] = []

    def apply_server_side(self, manifest: str, *, field_manager: str) -> None:
        self.applied.append((manifest, field_manager))


def _kubectl(fake: _FakeKubectl) -> Kubectl:
    return fake  # type: ignore[return-value]


def _yq(fake: _FakeYq) -> Yq:
    return fake  # type: ignore[return-value]


def test_rollout_web_applies_only_the_deployment() -> None:
    yq = _FakeYq("kind: Deployment\n")
    kubectl = _FakeKubectl()
    rollout_web(_kubectl(kubectl), _yq(yq), rendered_path=Path("rendered.yaml"))
    assert yq.selectors == ['select(.kind == "Deployment")']  # Deployment only
    assert kubectl.applied == [("kind: Deployment\n", "devstash-deploy")]  # stable field-manager


def test_ssa_apply_threads_selector_and_field_manager() -> None:
    yq = _FakeYq("kind: Gateway\n")
    kubectl = _FakeKubectl()
    ssa_apply(
        _kubectl(kubectl),
        _yq(yq),
        selector='select(.kind != "Deployment")',
        rendered_path=Path("rendered.yaml"),
        field_manager="custom-mgr",
    )
    assert yq.selectors == ['select(.kind != "Deployment")']
    assert kubectl.applied == [("kind: Gateway\n", "custom-mgr")]
