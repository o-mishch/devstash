"""Tests for clients/health.py — the deep-health predicate (parity with ds_health_ok)."""

import httpx
import pytest

from devstash_infra.clients import health


class _FakeResponse:
    """Minimal stand-in for httpx.Response: scripts raise_for_status + json()."""

    def __init__(self, *, status_ok: bool = True, body: object) -> None:
        self._status_ok = status_ok
        self._body = body

    def raise_for_status(self) -> None:
        if not self._status_ok:
            raise httpx.HTTPError("non-2xx")

    def json(self) -> object:
        if isinstance(self._body, ValueError):
            raise self._body
        return self._body


def _route(monkeypatch: pytest.MonkeyPatch, response: _FakeResponse | httpx.HTTPError) -> list[str]:
    urls: list[str] = []

    def _fake_get(url: str, *, timeout: float) -> _FakeResponse:  # timeout accepted for parity
        _ = timeout
        urls.append(url)
        if isinstance(response, httpx.HTTPError):
            raise response
        return response

    # health.py calls httpx.get; patch the module attr both share (avoids an implicit re-export).
    monkeypatch.setattr(httpx, "get", _fake_get)
    return urls


def test_healthy_when_status_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    urls = _route(monkeypatch, _FakeResponse(body={"status": "ok"}))
    assert health.deep_health_ok("https://app/api/health?deep=1") is True
    assert urls == ["https://app/api/health?deep=1"]


def test_unhealthy_when_status_not_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    _route(monkeypatch, _FakeResponse(body={"status": "degraded"}))
    assert health.deep_health_ok("https://app") is False


def test_non_2xx_reads_as_unhealthy(monkeypatch: pytest.MonkeyPatch) -> None:
    _route(monkeypatch, _FakeResponse(status_ok=False, body={"status": "ok"}))
    assert health.deep_health_ok("https://app") is False


def test_non_json_body_reads_as_unhealthy(monkeypatch: pytest.MonkeyPatch) -> None:
    _route(monkeypatch, _FakeResponse(body=ValueError("not json")))
    assert health.deep_health_ok("https://app") is False


def test_transport_error_reads_as_unhealthy(monkeypatch: pytest.MonkeyPatch) -> None:
    _route(monkeypatch, httpx.ConnectError("refused"))
    assert health.deep_health_ok("https://app") is False


def test_report_pretty_prints_json_body(monkeypatch: pytest.MonkeyPatch) -> None:
    _route(monkeypatch, _FakeResponse(body={"status": "ok", "db": "up"}))
    report = health.deep_health_report("https://app/api/health?deep=1")
    assert '"status": "ok"' in report
    assert '"db": "up"' in report  # the full body is shown, not just a bool


def test_report_empty_when_unreachable(monkeypatch: pytest.MonkeyPatch) -> None:
    _route(monkeypatch, httpx.ConnectError("refused"))
    assert health.deep_health_report("https://app") == ""  # tolerant → "" (caller warns)
