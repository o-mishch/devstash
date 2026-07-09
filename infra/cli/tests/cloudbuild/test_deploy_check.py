"""Tests for cloudbuild/deploy_check.py — the fail-safe deploy-in-flight guard check."""

import pytest
import requests

from devstash_infra.cloudbuild.deploy_check import deploy_in_flight, github_run_count


class _FakeResponse:
    """Minimal stand-in for requests.Response used by the run-count test."""

    def __init__(self, payload: object) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> object:
        return self._payload


def test_in_flight_when_a_run_is_in_progress() -> None:
    def _count(_slug: str, status: str) -> int:
        return 1 if status == "in_progress" else 0

    assert deploy_in_flight("owner/repo", run_count=_count) is True


def test_in_flight_when_a_run_is_queued() -> None:
    def _count(_slug: str, status: str) -> int:
        return 1 if status == "queued" else 0

    assert deploy_in_flight("owner/repo", run_count=_count) is True


def test_not_in_flight_when_no_runs() -> None:
    def _count(_slug: str, _status: str) -> int:
        return 0

    assert deploy_in_flight("owner/repo", run_count=_count) is False


def test_fails_safe_to_in_flight_on_api_error(capsys: pytest.CaptureFixture[str]) -> None:
    def _boom(_slug: str, _status: str) -> int:
        raise OSError("connection refused")

    assert deploy_in_flight("owner/repo", run_count=_boom) is True  # ANY failure → don't suspend
    assert "failing safe as in-flight" in capsys.readouterr().err


def test_github_run_count_reads_total_via_requests(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    def _fake_get(
        url: str, *, params: dict[str, object], headers: dict[str, str], timeout: int
    ) -> _FakeResponse:
        captured.update(url=url, params=params, headers=headers)
        return _FakeResponse({"total_count": 2})

    monkeypatch.setattr(requests, "get", _fake_get)
    assert github_run_count("owner/repo", "in_progress") == 2
    assert captured["url"] == (
        "https://api.github.com/repos/owner/repo/actions/workflows/deploy-gke.yml/runs"
    )
    assert captured["params"] == {"status": "in_progress", "per_page": 1}
