"""Tests for ci/apply_infra.py — legacy-Ingress cleanup + SSA-apply of all but the Deployment."""

from pathlib import Path

from devstash_infra.ci.apply_infra import apply_infra
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
        self.deleted: list[tuple[str, str, str]] = []
        self.applied: list[tuple[str, str]] = []

    def delete(self, kind: str, name: str, *, namespace: str) -> None:
        self.deleted.append((kind, name, namespace))

    def apply_server_side(self, manifest: str, *, field_manager: str) -> None:
        self.applied.append((manifest, field_manager))


def _kubectl(fake: _FakeKubectl) -> Kubectl:
    return fake  # type: ignore[return-value]


def _yq(fake: _FakeYq) -> Yq:
    return fake  # type: ignore[return-value]


def test_deletes_legacy_stack_then_applies_non_deployment() -> None:
    yq = _FakeYq("kind: Gateway\n")
    kubectl = _FakeKubectl()
    apply_infra(_kubectl(kubectl), _yq(yq), namespace="devstash", rendered_path=Path("r.yaml"))

    # The four legacy GCE-Ingress objects are deleted (idempotent one-time cleanup)…
    assert kubectl.deleted == [
        ("ingress", "devstash-web", "devstash"),
        ("backendconfig", "devstash-backendconfig", "devstash"),
        ("frontendconfig", "devstash-frontendconfig", "devstash"),
        ("managedcertificate", "devstash-cert", "devstash"),
    ]
    # …then everything EXCEPT the Deployment is server-side applied under the stable manager.
    assert yq.selectors == ['select(.kind != "Deployment")']
    assert kubectl.applied == [("kind: Gateway\n", "devstash-deploy")]
