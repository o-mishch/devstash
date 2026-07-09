"""cloudbuild/idle_count.py — sum ingress LB request_count over the idle window. 3.14 floor.

Port of terraform/envs/dev/scripts/auto-suspend-idle-count.py (Cloud Build guard step). Uses the
vendored `requests` (gcloud's lib/third_party copy on the image; the pinned `vendored` dep on
dev/CI) — pydantic stays off-limits in the floor, so the response is typed with a `TypedDict`
schema and validated at one boundary `cast`, the stdlib-native way to type JSON. Queries Cloud
Monitoring for `loadbalancing.googleapis.com/https/request_count` aggregated (ALIGN_SUM +
REDUCE_SUM); the total decides the guard's genuinely-idle branch. All inputs are parameters — the
OAuth token never lands in argv / the process list.

`sum_request_count` is a pure fold over the typed response (unit-testable); `fetch_request_count` is
the thin GET that parses the payload into that shape and feeds it. `raise_for_status()` turns a 4xx/
5xx into an error, and a response that does NOT match the documented Monitoring shape raises rather
than silently summing to 0 — the safe failure mode for a suspend guard, where a bogus 0 would read
as "idle" and tear the cluster down.
"""

from typing import ReadOnly, TypedDict, cast

import requests

_MONITORING_URL = "https://monitoring.googleapis.com/v3/projects/{project}/timeSeries"
_HTTP_TIMEOUT_S = 30  # bound the unattended call so the guard step can't hang on a slow API


# The Cloud Monitoring timeSeries response, typed as far as we read it. `total=False` on every shape
# because each key may be absent — an idle window returns no series at all, and a point may carry
# either int64Value or doubleValue. Field names mirror the API's camelCase JSON keys verbatim.
class _MetricValue(TypedDict, total=False):
    int64Value: ReadOnly[str]
    doubleValue: ReadOnly[float]


class _MetricPoint(TypedDict, total=False):
    value: ReadOnly[_MetricValue]


class _MetricSeries(TypedDict, total=False):
    points: ReadOnly[list[_MetricPoint]]


class TimeSeriesResponse(TypedDict, total=False):
    timeSeries: ReadOnly[list[_MetricSeries]]


def sum_request_count(response: TimeSeriesResponse) -> int:
    """Sum every point's value across all time series (int64Value or doubleValue), as an int.

    int64Value arrives as a numeric STRING, doubleValue as a number — `float` accepts either.
    """
    total = 0.0
    for series in response.get("timeSeries", []):
        for point in series.get("points", []):
            # `point["value"]` (not `.get`) so a point missing `value` RAISES KeyError → the guard
            # step fails → NO suspend. Matches the original auto-suspend-idle-count.py's strictness:
            # a malformed Monitoring payload must fail safe, never silently sum to 0 ("idle"). The
            # KeyError IS the safety mechanism, so the not-required-key access is deliberate.
            value = point["value"]  # pyright: ignore[reportTypedDictNotRequiredAccess] — see above
            total += float(value.get("int64Value") or value.get("doubleValue") or 0)
    return int(total)


def fetch_request_count(*, project: str, start: str, end: str, window_s: str, token: str) -> int:
    """GET the Monitoring timeSeries for the window and return the summed request count.

    `start`/`end` are RFC3339 interval bounds; `window_s` is the alignment period in seconds.
    """
    params = {
        "filter": 'metric.type="loadbalancing.googleapis.com/https/request_count"',
        "interval.startTime": start,
        "interval.endTime": end,
        "aggregation.alignmentPeriod": f"{window_s}s",
        "aggregation.perSeriesAligner": "ALIGN_SUM",
        "aggregation.crossSeriesReducer": "REDUCE_SUM",
    }
    response = requests.get(
        _MONITORING_URL.format(project=project),
        params=params,
        headers={"Authorization": f"Bearer {token}"},
        timeout=_HTTP_TIMEOUT_S,
    )
    response.raise_for_status()
    # One boundary cast: assert the parsed JSON matches the documented Monitoring shape.
    return sum_request_count(cast("TimeSeriesResponse", response.json()))
