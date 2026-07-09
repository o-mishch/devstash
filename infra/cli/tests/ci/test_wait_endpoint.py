"""Tests for ci/wait_endpoint.py — the public-URL gate (skip / serve / timeout)."""

import pytest

from devstash_infra.ci.wait_endpoint import wait_endpoint
from devstash_infra.clients.kubectl import Kubectl


class _FakeKubectl:
    """Scripts the two diagnostic `get` reads used on the timeout path."""

    def get(
        self, target: str, *, namespace: str, output: str | None = None, sort_by: str | None = None
    ) -> str:
        return f"diagnostics for {target}"


def _kubectl(fake: _FakeKubectl) -> Kubectl:
    return fake  # type: ignore[return-value]


class _HealthAfter:
    """A health_ok stub that is False until the `serve_on`-th probe, then True."""

    def __init__(self, serve_on: int) -> None:
        self.serve_on = serve_on
        self.urls: list[str] = []

    def __call__(self, url: str) -> bool:
        self.urls.append(url)
        return len(self.urls) >= self.serve_on


def test_unset_domain_skips_with_warning(capsys: pytest.CaptureFixture[str]) -> None:
    wait_endpoint(_kubectl(_FakeKubectl()), app_domain="", namespace="devstash")
    assert "::warning::" in capsys.readouterr().out  # skip, rollout is still healthy


def test_serving_endpoint_returns() -> None:
    health = _HealthAfter(serve_on=1)
    wait_endpoint(
        _kubectl(_FakeKubectl()),
        app_domain="app.example.com",
        namespace="devstash",
        health_ok=health,
        attempts=3,
        gap_s=0,
    )
    assert health.urls == ["https://app.example.com/api/health?deep=1"]


def test_endpoint_becomes_healthy_before_deadline() -> None:
    health = _HealthAfter(serve_on=3)
    wait_endpoint(
        _kubectl(_FakeKubectl()),
        app_domain="app.example.com",
        namespace="devstash",
        health_ok=health,
        attempts=5,
        gap_s=0,
    )
    assert len(health.urls) == 3


def test_never_healthy_raises_and_dumps_gateway(capsys: pytest.CaptureFixture[str]) -> None:
    health = _HealthAfter(serve_on=999)  # never serves
    with pytest.raises(Exception, match="did not report healthy"):
        wait_endpoint(
            _kubectl(_FakeKubectl()),
            app_domain="app.example.com",
            namespace="devstash",
            health_ok=health,
            attempts=3,
            gap_s=0,
        )
    err = capsys.readouterr().err
    assert "Gateway / HTTPRoute status" in err and "Recent namespace events" in err
