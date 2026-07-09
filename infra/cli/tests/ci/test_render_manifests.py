"""Tests for ci/render_manifests.py — render once to a file + drop the empty-armor field."""

from pathlib import Path

from devstash_infra.ci.render_manifests import render_manifests
from devstash_infra.clients.kubectl import Kubectl
from devstash_infra.clients.yq import Yq

_RENDERED = "apiVersion: v1\nkind: ConfigMap\n"


class _FakeKubectl:
    def kustomize(self, directory: str) -> str:
        self.rendered_from = directory
        return _RENDERED


class _RecordingYq:
    def __init__(self) -> None:
        self.edits: list[tuple[str, str]] = []

    def eval_in_place(
        self, expression: str, path: str, *, env_extra: dict[str, str] | None = None
    ) -> None:
        self.edits.append((expression, path))


def _kubectl(fake: _FakeKubectl) -> Kubectl:
    return fake  # type: ignore[return-value]


def _yq(fake: _RecordingYq) -> Yq:
    return fake  # type: ignore[return-value]


def test_writes_rendered_file_then_drops_empty_armor(tmp_path: Path) -> None:
    rendered = tmp_path / "rendered.yaml"
    yq = _RecordingYq()
    render_manifests(
        _kubectl(_FakeKubectl()), _yq(yq), overlay_dir=Path("overlays/gcp"), rendered_path=rendered
    )
    # the kustomize output lands in the shared file…
    assert rendered.read_text() == _RENDERED
    # …then the empty-armor securityPolicy delete runs against that file.
    assert len(yq.edits) == 1
    expression, path = yq.edits[0]
    assert path == str(rendered)
    assert "GCPBackendPolicy" in expression and "del(.spec.default.securityPolicy)" in expression
