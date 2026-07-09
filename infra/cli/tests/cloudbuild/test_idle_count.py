"""Tests for cloudbuild/idle_count.py — the pure request_count fold (idle-window sum)."""

from typing import cast

import pytest
import requests

from devstash_infra.cloudbuild.idle_count import (
    TimeSeriesResponse,
    fetch_request_count,
    sum_request_count,
)


class _FakeResponse:
    """Minimal stand-in for requests.Response used by the fetch test."""

    def __init__(self, payload: object) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> object:
        return self._payload


def _response(*point_values: dict[str, object]) -> TimeSeriesResponse:
    return {"timeSeries": [{"points": [{"value": value} for value in point_values]}]}  # type: ignore[typeddict-item]


def test_sums_int64_values_across_points() -> None:
    # Monitoring returns int64Value as a numeric STRING.
    assert sum_request_count(_response({"int64Value": "3"}, {"int64Value": "4"})) == 7


def test_sums_double_values() -> None:
    assert sum_request_count(_response({"doubleValue": 1.5}, {"doubleValue": 2.5})) == 4


def test_sums_across_multiple_series() -> None:
    response: TimeSeriesResponse = {
        "timeSeries": [
            {"points": [{"value": {"int64Value": "10"}}]},
            {"points": [{"value": {"int64Value": "5"}}]},
        ]
    }
    assert sum_request_count(response) == 15


def test_empty_response_is_zero() -> None:
    # An idle window returns no series at all — the fold is zero, not an error.
    assert sum_request_count({}) == 0
    assert sum_request_count({"timeSeries": []}) == 0


def test_point_missing_value_raises_fails_safe() -> None:
    # A malformed point (no `value`) must RAISE, not silently contribute 0 — a payload that would
    # otherwise read as "idle" and tear the cluster down instead fails the guard step (no suspend).
    malformed: TimeSeriesResponse = {"timeSeries": [{"points": [{}]}]}
    with pytest.raises(KeyError):
        sum_request_count(malformed)


def test_fetch_request_count_gets_and_folds(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    def _fake_get(
        url: str, *, params: dict[str, str], headers: dict[str, str], timeout: int
    ) -> _FakeResponse:
        captured.update(url=url, params=params, headers=headers, timeout=timeout)
        return _FakeResponse({"timeSeries": [{"points": [{"value": {"int64Value": "6"}}]}]})

    monkeypatch.setattr(requests, "get", _fake_get)
    total = fetch_request_count(project="p", start="s", end="e", window_s="300", token="tok")
    assert total == 6
    assert captured["url"] == "https://monitoring.googleapis.com/v3/projects/p/timeSeries"
    assert captured["headers"] == {"Authorization": "Bearer tok"}  # token in header, never argv
    params = cast("dict[str, str]", captured["params"])
    assert params["aggregation.perSeriesAligner"] == "ALIGN_SUM"
    assert params["aggregation.alignmentPeriod"] == "300s"
