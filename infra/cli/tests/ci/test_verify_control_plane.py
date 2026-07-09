"""Tests for ci/verify_control_plane.py — reachable / benign-skip / loud 403-drift branches."""

import pytest

from devstash_infra.ci.verify_control_plane import verify_control_plane
from devstash_infra.clients.kubectl import Kubectl
from devstash_infra.shared.errors import InfraError
from devstash_infra.shared.proc import Result


class _FakeKubectl:
    """Scripts the single `get_raw('/readyz')` probe."""

    def __init__(self, probe: Result) -> None:
        self._probe = probe
        self.paths: list[str] = []

    def get_raw(self, path: str) -> Result:
        self.paths.append(path)
        return self._probe


def _kubectl(fake: _FakeKubectl) -> Kubectl:
    return fake  # type: ignore[return-value]


def _probe(*, stdout: str = "", stderr: str = "", code: int = 0) -> Result:
    return Result(["kubectl", "get", "--raw=/readyz"], stdout, stderr, code)


def test_reachable_returns_true() -> None:
    fake = _FakeKubectl(_probe(stdout="ok"))
    assert verify_control_plane(_kubectl(fake), cluster="c", region="r") is True
    assert fake.paths == ["/readyz"]


def test_generic_403_forbidden_raises_with_gate_guidance() -> None:
    fake = _FakeKubectl(_probe(stderr="error: 403 (Forbidden)\n<html>...", code=1))
    with pytest.raises(InfraError) as excinfo:
        verify_control_plane(_kubectl(fake), cluster="devstash-dev-gke", region="us-central1")
    exc = excinfo.value
    assert "Google Front End" in exc.message
    assert "a051ad7" in exc.hint  # gate 1 (IAM condition) guidance
    assert "allow_external_traffic" in exc.hint  # gate 2 (network) guidance
    assert "devstash-dev-gke" in exc.hint and "us-central1" in exc.hint  # interpolated probe cmd


def test_google_error_page_signature_raises() -> None:
    # The bare Google 502/403 HTML page ("That’s an error") — the curly-apostrophe variant.
    fake = _FakeKubectl(_probe(stderr="That’s an error.", code=1))
    with pytest.raises(InfraError):
        verify_control_plane(_kubectl(fake), cluster="c", region="r")


def test_other_unreachable_warns_and_skips(capsys: pytest.CaptureFixture[str]) -> None:
    fake = _FakeKubectl(
        _probe(stderr="Unable to connect to the server: dial tcp: no route", code=1)
    )
    assert verify_control_plane(_kubectl(fake), cluster="c", region="r") is False
    assert "::warning::" in capsys.readouterr().out  # skip, not fail
