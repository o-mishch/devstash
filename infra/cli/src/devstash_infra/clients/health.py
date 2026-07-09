"""clients/health.py — the deep-health HTTP predicate. CLI zone (3.14).

Port of `ds_health_ok` (infra/lib/common.sh): `curl -sf --max-time 10 <url> | jq '.status=="ok"'`.
The contract HTTP-200-alone can't express: a `?deep=1` probe passes ONLY when the JSON body reports
`{"status":"ok"}`, which means the app served a real request end-to-end (the DB is reachable too),
not that some 200 came back from an edge. httpx stays encapsulated here behind a plain predicate so
callers (wait-endpoint now, `gcp smoke` later) never see the transport — same as the shell hid curl
behind a function name.
"""

import json

import httpx

_TIMEOUT_S = 10.0  # matches curl --max-time 10
_REPORT_TIMEOUT_S = 5.0  # matches status()'s curl --max-time 5


def deep_health_ok(url: str) -> bool:
    """True iff GET <url> returns 2xx with a JSON body reporting `status: "ok"`.

    Every transport/parse failure (connect error, non-2xx, non-JSON, wrong shape) reads as
    not-healthy → False, exactly like curl `-sf` piped into `jq -e`: the caller keeps polling.
    """
    try:
        response = httpx.get(url, timeout=_TIMEOUT_S)
        response.raise_for_status()  # curl -f: a non-2xx is a failure, not a body to inspect
        return bool(response.json().get("status") == "ok")
    except httpx.HTTPError, ValueError:  # transport/HTTP error, or a non-JSON body
        return False


def deep_health_report(url: str) -> str:
    """GET <url> and return its JSON body pretty-printed, or "" if unreachable — the `status` view.

    The display twin of `deep_health_ok`: `status` shows an operator the health JSON (the shell's
    `curl -sf --max-time 5 … | jq .`), so tolerance returns "" (the caller warns) rather than a
    bool. Uses the shorter 5s timeout the shell's status probe did.
    """
    try:
        response = httpx.get(url, timeout=_REPORT_TIMEOUT_S)
        response.raise_for_status()
        return json.dumps(response.json(), indent=2)
    except httpx.HTTPError, ValueError:
        return ""
